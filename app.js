let SEED_CARDS = [];
let cardOverrides = {};
let customCards = [];
let ALL_CARDS = [];
let COLLECTION = {}; // {cardId: count}
let DECKS = [null, null, null]; // up to 3 decks: {name, cards:{cardId:count}} or null

function specClass(sp){ return "spec-"+ (sp||"partner").toLowerCase(); }
function effectText(card){ return card.type==='option' ? (card.effect||'') : (card.note||''); }

function rebuildAllCards(){
  ALL_CARDS = SEED_CARDS.map(c=>{
    const ov = cardOverrides[c.id];
    return ov ? Object.assign({}, c, ov) : Object.assign({}, c);
  }).concat(customCards.map(c=>Object.assign({}, c)));
}

async function loadCardJson(){
  const el = document.getElementById('loadError');
  try{
    const resp = await fetch('cards.json');
    if(!resp.ok) throw new Error('HTTP '+resp.status);
    SEED_CARDS = await resp.json();
    if(el) el.style.display='none';
  }catch(e){
    if(el){
      el.style.display='block';
      el.innerHTML = `<b>Could not load cards.json</b> (${e.message}).<br>
      If you opened this file directly by double-clicking it, your browser is blocking local file requests (a Chrome/Edge CORS restriction).
      Fix: open a terminal in this folder and run <code>python3 -m http.server 8000</code>, then visit
      <code>http://localhost:8000/index.html</code>. Firefox usually works fine without this step.`;
    }
    SEED_CARDS = [];
  }
}

const STORAGE_PREFIX = 'ddcb_';
async function loadStorage(){
  try{ const r = localStorage.getItem(STORAGE_PREFIX+'card_overrides'); if(r) cardOverrides = JSON.parse(r); }catch(e){ cardOverrides = {}; }
  try{ const r2 = localStorage.getItem(STORAGE_PREFIX+'custom_cards'); if(r2) customCards = JSON.parse(r2); }catch(e){ customCards = []; }
  try{ const r3 = localStorage.getItem(STORAGE_PREFIX+'collection'); if(r3) COLLECTION = JSON.parse(r3); }catch(e){ COLLECTION = {}; }
  try{ const r4 = localStorage.getItem(STORAGE_PREFIX+'decks'); if(r4) DECKS = JSON.parse(r4); }catch(e){ DECKS = [null,null,null]; }
  rebuildAllCards();
}
async function saveOverrides(){ try{ localStorage.setItem(STORAGE_PREFIX+'card_overrides', JSON.stringify(cardOverrides)); }catch(e){ console.error('Save failed:', e); } }
async function saveCustomCards(){ try{ localStorage.setItem(STORAGE_PREFIX+'custom_cards', JSON.stringify(customCards)); }catch(e){ console.error('Save failed:', e); } }
async function saveCollection(){ try{ localStorage.setItem(STORAGE_PREFIX+'collection', JSON.stringify(COLLECTION)); }catch(e){ console.error('Save failed:', e); } }
async function saveDecks(){ try{ localStorage.setItem(STORAGE_PREFIX+'decks', JSON.stringify(DECKS)); }catch(e){ console.error('Save failed:', e); } }

// Parses one line of pasted collection/deck text into {name, count}. Handles:
//  "011 - Lv U - Type Fire - Meteormon - 1 Cards"   (in-game collection menu format)
//  "2 Tyrannomon" / "Tyrannomon x2" / "Tyrannomon x 2"
//  "1. Tyrannomon" (numbered deck list -- count implied as 1)
//  "Tyrannomon"    (bare name -- count implied as 1)
function parseCollectionLine(line){
  line = line.trim();
  if(!line) return null;
  let m;
  // in-game collection menu format: "011 - Lv U - Type Fire - Meteormon - 1 Cards"
  // (also tolerates "N/A" fields for Option cards with no level/type)
  if(/-\s*\d+\s*Cards?\s*$/i.exec(line)){
    const parts = line.split(/\s*-\s*/).map(p=>p.trim()).filter(p=>p.length);
    const countPart = parts[parts.length-1];
    const namePart = parts[parts.length-2];
    const cm = /(\d+)\s*Cards?/i.exec(countPart);
    if(cm && namePart) return { name: namePart.replace(/\(Partner\)/i,'').trim(), count: parseInt(cm[1]) };
  }
  if(m = /^(\d+)\s*[.):]\s*(.+)$/.exec(line)){
    // numbered list entry, e.g. "1. Tyrannomon" -- the number is a LIST INDEX not a count
    return { name: m[2].replace(/\(Partner\)/i,'').trim(), count: 1 };
  }
  if(m = /^(.+?)\s*[x×]\s*(\d+)$/i.exec(line)){
    return { name: m[1].replace(/\(Partner\)/i,'').trim(), count: parseInt(m[2]) };
  }
  if(m = /^(\d+)\s*[x×]?\s+(.+)$/i.exec(line)){
    return { name: m[2].replace(/\(Partner\)/i,'').trim(), count: parseInt(m[1]) };
  }
  return { name: line.replace(/\(Partner\)/i,'').trim(), count: 1 };
}

function findCardByName(name){
  if(!name) return null;
  const n = name.trim().toLowerCase();
  return ALL_CARDS.find(c=>c.name.toLowerCase()===n) || null;
}
function searchCards(query, opts={}){
  const q = (query||'').trim().toLowerCase();
  let pool = ALL_CARDS;
  if(opts.type) pool = pool.filter(c=>c.type===opts.type);
  if(opts.onlyInDeck){ pool = pool.filter(c=>deckRemaining(c.id)>0); }
  if(!q) return pool.slice(0, opts.limit||8);
  return pool.filter(c=>c.name.toLowerCase().includes(q)).slice(0, opts.limit||8);
}

function wordToAtk(w){
  w=(w||'').toLowerCase();
  if(w.startsWith('circ') || w==='o') return 'o';
  if(w.startsWith('tri') || w==='t') return 't';
  if(w.startsWith('x') || w.startsWith('cross')) return 'x';
  return null;
}
const SPEC_NAME_MAP = {fire:'Fire', water:'Water', nature:'Nature', darkness:'Darkness', rare:'Rare'};
function parseFoeMultiplier(xt){
  const m = /^(fire|water|nature|darkness|rare)\s+foe\s+x(\d+)$/i.exec((xt||"").trim());
  if(!m) return null;
  return { spec: SPEC_NAME_MAP[m[1].toLowerCase()], mult: parseInt(m[2]) };
}
function parseNegateTag(xt){
  const m = /^(O|T|X)\s+to\s+0$/i.exec((xt||"").trim());
  return m ? m[1].toUpperCase() : null;
}
function isFirstStrikeXTag(xt){ return /^1st attack$/i.test((xt||"").trim()); }
function baseVal(card, atk){ return atk==='o'?card.o: atk==='t'?card.t: card.x; }

// Full official description: "If Opponent uses [X] Attack, it will miss. Then
// you counter with opponent's [X] attack power." Triggers when THIS card's
// owner presses Cross and the opponent happens to pick the matching attack --
// their hit is negated and replaced with a reflect using THEIR OWN stat at
// that attack type (which is why counter cards are always printed with X:0 --
// the plain Cross whiff is the fallback when the condition isn't met).
function parseCounterTag(xt){
  const m = /^(O|T|X)\s+counter$/i.exec((xt||"").trim()) || /^counter\s+(O|T|X)$/i.exec((xt||"").trim());
  return m ? m[1].toUpperCase() : null;
}
// "Attack Power becomes same as HP. HP becomes 10." -- own Cross damage is
// replaced by current HP, then HP is set to exactly 10 after the bout resolves.
function isCrashXTag(xt){ return /^crash$/i.test((xt||"").trim()); }
// "Recover the same amount of HP as the damage inflicted" -- lifesteal on Cross.
function isEatUpHpXTag(xt){ return /^eat[\s-]?up hp$/i.test((xt||"").trim()); }
// "Opponent's Support Effect is Voided. Can't Void Option Effect." -- voids
// the opponent's DIGIMON-card support effect specifically, not Option cards.
function xtGrantsJamming(xt){ return /^jamming$/i.test((xt||"").trim()); }

function effectiveDamage(attacker, atkKey, defender, valueKey){
  const vk = valueKey || atkKey;
  let val = baseVal(attacker, vk);
  if(atkKey==='x'){
    const fm = parseFoeMultiplier(attacker.xt);
    if(fm && defender.sp === fm.spec) val = val * fm.mult;
  }
  return val;
}

function activeGrantsFirstStrike(card, atk){
  if(!card) return false;
  if(atk==='x' && isFirstStrikeXTag(card.xt)) return true;
  const note = (card.note||'').trim();
  if(/^Attack first\.?$/i.test(note)) return true;
  const m = /If own Attack is (O|T|X), Attack first/i.exec(note);
  if(m && wordToAtk(m[1])===atk) return true;
  return false;
}

// ======================= SUPPORT-EFFECT PARSER =======================
// Card effect text -> tags the solver understands. Text is parsed one SENTENCE at a
// time, so an "If ..., " prefix only gates the effects in its own sentence ("If foe's
// Specialty is Nature, own Attack Power is doubled. Draw 1 card." must not gate the
// draw). A condition the solver can't evaluate (hand size, DP slot counts...) drops
// that sentence's effects instead of applying them as if the condition were met, and
// anything combat-relevant that no rule recognises is listed in tags.unmodelled so the
// UI can say "partly modeled" instead of silently scoring it as nothing.
const LEVEL_RANK = {R:0, A:0, C:1, U:2}; // Armor ranks with Rookie -- same assumption as digivolveOptions()
const ATK_ALT = '(O|T|X|Circle|Triangle|Cross)(?![A-Za-z])';
const SPEC_ALT = '(fire|water|nature|dark(?:ness)?|rare)(?![A-Za-z])';
function rx(src, flags){ return new RegExp(src.replace(/\{A\}/g, ATK_ALT).replace(/\{SP\}/g, SPEC_ALT), flags||'i'); }
function normSpecWord(w){ w=(w||'').toLowerCase(); return w.startsWith('dark') ? 'Darkness' : (SPEC_NAME_MAP[w]||null); }
function normEffectText(t){
  return String(t||'').replace(/[\u2018\u2019\u02bc]/g,"'").replace(/[\u201c\u201d]/g,'"').replace(/\u00a0/g,' ').replace(/\s+/g,' ').trim();
}
function splitEffectSentences(t){
  return (t.match(/[^.!?]+(?:[.!?]+["']?|$)/g)||[t]).map(s=>s.trim()).filter(Boolean);
}

function parseEffectCondition(raw){
  const c = raw.replace(/[.\s]+$/,'').trim(); let m;
  if(/^both (?:players'? )?attacks? (?:are|is) different$/i.test(c)) return {kind:'attacksDiffer'};
  if(/^both (?:players'? )?attacks? (?:are|is) (?:the )?same$/i.test(c) || /^both players use the same attack$/i.test(c)) return {kind:'attacksSame'};
  if(m = rx(String.raw`^(?:opponent|foe) (?:used|uses) {A}(?: attack)?$`).exec(c)) return {kind:'foeAttack', attack:wordToAtk(m[1])};
  if(m = rx(String.raw`^own attack is (not )?{A}$`).exec(c)) return {kind:'ownAttack', attack:wordToAtk(m[2]), not:!!m[1]};
  if(m = rx(String.raw`^(?:opponent'?s|foe'?s) specialty is (not )?{SP}(?: or {SP})?$`).exec(c))
    return {kind:'foeSpec', specs:[normSpecWord(m[2]), m[3]?normSpecWord(m[3]):null].filter(Boolean), not:!!m[1]};
  if(m = rx(String.raw`^opponent is {SP}$`).exec(c)) return {kind:'foeSpec', specs:[normSpecWord(m[1])], not:false};
  if(m = rx(String.raw`^own specialty is {SP}$`).exec(c)) return {kind:'ownSpec', specs:[normSpecWord(m[1])]};
  if(/^both players'? specialties are the same$/i.test(c)) return {kind:'bothSpecSame'};
  if(m = /^own level is ([RCUA])$/i.exec(c)) return {kind:'ownLevel', lvl:m[1].toUpperCase()};
  if(m = /^opponent is level ([RCUA])$/i.exec(c) || /^opponent'?s level is ([RCUA])$/i.exec(c)) return {kind:'foeLevel', lvl:m[1].toUpperCase()};
  if(m = /^both levels are ([RCUA])$/i.exec(c)) return {kind:'bothLevel', lvl:m[1].toUpperCase()};
  if(/^own level is (?:below(?: opponent'?s)?|lower(?: than opponent'?s)?)$/i.test(c)) return {kind:'levelBelow'};
  if(/^(?:own )?HP (?:is|are) (?:less|lower) than (?:opponent'?s|foe'?s)(?: HP)?$/i.test(c)) return {kind:'ownHpLess'};
  if(/^own HP (?:is|are) (?:more|higher|greater) than (?:opponent'?s|foe'?s)(?: HP)?$/i.test(c)) return {kind:'ownHpMore'};
  if(/^(?:opponent'?s|foe'?s) HP (?:is|are) (?:less|lower) than own(?: HP)?$/i.test(c)) return {kind:'foeHpLess'};
  if(m = /^own HP (?:is|are) less than (\d+)$/i.exec(c)) return {kind:'ownHpUnder', n:+m[1]};
  if(m = /^(?:opponent'?s|foe'?s) HP (?:is|are) more than (\d+)$/i.exec(c)) return {kind:'foeHpOver', n:+m[1]};
  if(m = /^(?:opponent'?s|foe'?s) HP (?:is|are) (\d+)\+$/i.exec(c)) return {kind:'foeHpAtLeast', n:+m[1]};
  return {kind:'unknown', text:c};
}

// x = {own, foe (cards), ownHp, foeHp, ownAtk, foeAtk} from the point of view of the
// player whose support card carries the condition. Everything is checked against the
// cards / HP / attacks as chosen, before any support effect in the bout changes them.
function conditionHolds(c, x){
  if(typeof c==='string') c = {kind:c};
  switch(c.kind){
    case 'attacksDiffer': return x.ownAtk !== x.foeAtk;
    case 'attacksSame':   return x.ownAtk === x.foeAtk;
    case 'foeAttack':     return x.foeAtk === c.attack;
    case 'ownAttack':     return c.not ? x.ownAtk !== c.attack : x.ownAtk === c.attack;
    case 'foeSpec':       return c.specs.includes(x.foe.sp) !== !!c.not;
    case 'ownSpec':       return c.specs.includes(x.own.sp);
    case 'bothSpecSame':  return !!x.own.sp && x.own.sp === x.foe.sp;
    case 'ownLevel':      return x.own.lvl === c.lvl;
    case 'foeLevel':      return x.foe.lvl === c.lvl;
    case 'bothLevel':     return x.own.lvl === c.lvl && x.foe.lvl === c.lvl;
    case 'levelBelow':    return LEVEL_RANK[x.own.lvl] < LEVEL_RANK[x.foe.lvl];
    case 'ownHpLess':     return x.ownHp < x.foeHp;
    case 'ownHpMore':     return x.ownHp > x.foeHp;
    case 'foeHpLess':     return x.foeHp < x.ownHp;
    case 'ownHpUnder':    return x.ownHp < c.n;
    case 'foeHpOver':     return x.foeHp > c.n;
    case 'foeHpAtLeast':  return x.foeHp >= c.n;
    default:              return false; // unknown conditions never fire
  }
}
function tagActive(t, x){ return !t.condition || conditionHolds(t.condition, x); }

// One rule = [regex, producer]. Rules run in order and each match is blanked out of the
// working text so a more specific rule can't be double-counted by a more general one
// below it (e.g. "Boost own X attack power +N" vs "Boost own attack power +N").
const EFFECT_RULES = [
  // ---- which attack gets used
  [rx(String.raw`both players use {A}`),                             m=>[{type:'forceBothAttack', attack:wordToAtk(m[1])}]],
  [rx(String.raw`forces? both players? (?:to use|to choose) {A}`),   m=>[{type:'forceBothAttack', attack:wordToAtk(m[1])}]],
  [rx(String.raw`both players'? attacks? become {A}`),               m=>[{type:'forceBothAttack', attack:wordToAtk(m[1])}]],
  [rx(String.raw`opponent uses {A}(?: attack)?`),                    m=>[{type:'forceOppAttack', attack:wordToAtk(m[1])}]],
  [rx(String.raw`change it to {A}`),                                 m=>[{type:'forceOppAttack', attack:wordToAtk(m[1])}]],
  [rx(String.raw`own attack (?:becomes|is) ['"]?\s*eat[ -]?up(?: HP)?[.'"]*`), ()=>[{type:'lockOwnAttack', attack:'x'}, {type:'eatUpHp'}]],
  [rx(String.raw`own attack becomes {A}`),                           m=>[{type:'lockOwnAttack', attack:wordToAtk(m[1])}]],
  [rx(String.raw`\buse {A} and\b`),                                  m=>[{type:'lockOwnAttack', attack:wordToAtk(m[1])}]],
  // "O and T attack power are 0" zeroes those attacks for whoever plays it. It does NOT switch you to the
  // third attack: support is chosen after the attack, so a locked-in Circle just deals 0 (seen in play with Tsukaimon).
  [rx(String.raw`{A} and {A} attack power (?:are|is|becomes?) 0`),   m=>[{type:'zeroOwnAttack', attack:wordToAtk(m[1])}, {type:'zeroOwnAttack', attack:wordToAtk(m[2])}]],
  // ---- turn order
  [rx(String.raw`attack first`),                                     ()=>[{type:'firstStrike'}]],
  // ---- both players' attack numbers
  [rx(String.raw`both players boost attack(?: power)? (?:by )?([+-]?\d+)`), m=>[{type:'boostBothAttack', amount:parseInt(m[1])}]],
  [rx(String.raw`(boost|lower) both players'? attack(?: power)? (?:by )?([+-]?)\s*(\d+)`), m=>[{type:'boostBothAttack', amount:(/lower/i.test(m[1])||m[2]==='-'?-1:1)*parseInt(m[3])}]],
  [rx(String.raw`both players'? attack(?: power)? (?:become|becomes|is|are) 0`), ()=>[{type:'zeroBothAttack'}]],
  // ---- own attack number
  [rx(String.raw`own attack power \+(\d+) & HP \+(\d+)`),            m=>[{type:'boostOwnAttack', amount:+m[1]}, {type:'healSelf', amount:+m[2]}]],
  [rx(String.raw`boost (?:own )?{A} attack(?: power)? (?:by )?([+-]?\d+)`), m=>[{type:'boostOwnAttackSpecific', attack:wordToAtk(m[1]), amount:parseInt(m[2])}]],
  [rx(String.raw`(boost|lower|reduce) (?:own )?attack(?: power)? (?:by )?([+-]?)\s*(\d+)`), m=>[{type:'boostOwnAttack', amount:(/lower|reduce/i.test(m[1])||m[2]==='-'?-1:1)*parseInt(m[3])}]],
  [rx(String.raw`own {A} attack(?: power)? (?:is|are) doubled`),     m=>[{type:'doubleOwnAttack', attack:wordToAtk(m[1])}]],
  [rx(String.raw`own {A} attack(?: power)? (?:is|are) (tripled|halved)`), m=>[{type:'multiplyOwnAttack', attack:wordToAtk(m[1]), mult:/tripled/i.test(m[2])?3:0.5}]],
  [rx(String.raw`own attack(?: power)? (?:is|are) (doubled|tripled|halved)`), m=>[{type:'multiplyOwnAttack', mult:{doubled:2, tripled:3, halved:0.5}[m[1].toLowerCase()]}]],
  [rx(String.raw`own attack(?: power)? becomes (\d+)`),              m=>[{type:'setOwnAttack', value:+m[1]}]],
  [rx(String.raw`own (?:{A} )?attack(?: power)? (?:is|becomes|matches) (?:the )?(?:same as )?(?:own )?HP(?:, then own HP are halved)?`),
    m=>[{type:'ownAttackEqualsHp', attack:m[1]?wordToAtk(m[1]):null, thenHalve:/then own HP are halved/i.test(m[0])}]],
  // ---- opponent's attack number
  [rx(String.raw`(?:lower|reduce) (?:opponent'?s|foe'?s)(?: {A})? (?:attack|power)(?: power)? to (\d+)`), m=>{
    const atk = m[1] ? wordToAtk(m[1]) : null, v = +m[2];
    return [v===0 ? {type:'zeroOppAttack', attack:atk} : {type:'capOppAttack', attack:atk, value:v}];
  }],
  [rx(String.raw`(?:lower|reduce) (?:opponent'?s|foe'?s)(?: {A})? attack(?: power)? (?:by )?-?\s*(\d+)`), m=>[{type:'lowerOppAttack', attack:m[1]?wordToAtk(m[1]):null, amount:+m[2]}]],
  [rx(String.raw`\b(?:opponent'?s|foe'?s|his) (?:{A} )?attack(?: power)? (?:is|are|goes to|go to|becomes?) (\d+)`), m=>{
    const atk = m[1] ? wordToAtk(m[1]) : null, v = +m[2];
    return [v===0 ? {type:'zeroOppAttack', attack:atk} : {type:'setOppAttack', attack:atk, value:v}];
  }],
  [rx(String.raw`\b(?:opponent'?s|his) attack(?: power)? (?:is|are) (doubled|tripled|halved)`), m=>[{type:'scaleOppAttack', mult:{doubled:2, tripled:3, halved:0.5}[m[1].toLowerCase()]}]],
  [rx(String.raw`opponent'?s attack changes`), ()=>[{type:'redirectOtherAttackValue', map:{o:'t', t:'x', x:'o'}}]], // Disrupt Ray: swaps only the damage NUMBER used, not the button pressed (confirmed by play)
  // ---- HP
  [rx(String.raw`both players'? HP are halved`),                     ()=>[{type:'halveSelfHp'}, {type:'halveOppHp'}]],
  [rx(String.raw`HP of both players are (\d+)`),                     m=>[{type:'setSelfHp', amount:+m[1]}, {type:'setOppHp', amount:+m[1]}]],
  [rx(String.raw`recover (?:foe'?s|opponent'?s) HP (?:by )?\+?(\d+)`), m=>[{type:'healOpp', amount:+m[1]}]],
  [rx(String.raw`recover (?:own )?HP,? (?:by )?\+?(\d+)`),           m=>[{type:'healSelf', amount:+m[1]}]],
  [rx(String.raw`own HP (?:are|is) halved`),                         ()=>[{type:'halveSelfHp'}]],
  [rx(String.raw`(?:opponent'?s|foe'?s) HP (?:are|is) halved`),      ()=>[{type:'halveOppHp'}]],
  [rx(String.raw`(?:opponent'?s|foe'?s) HP (?:are|is) doubled`),     ()=>[{type:'doubleOppHp'}]],
  [rx(String.raw`own HP becomes same as opponent'?s`),               ()=>[{type:'copyOppHpToSelf'}]],
  [rx(String.raw`opponent'?s HP become same as own`),                ()=>[{type:'copySelfHpToOpp'}]],
  [rx(String.raw`own HP becomes (\d+)`),                             m=>[{type:'setSelfHp', amount:+m[1]}]],
  [rx(String.raw`(?:opponent'?s|foe'?s) HP (?:becomes|become) (\d+)`), m=>[{type:'setOppHp', amount:+m[1]}]],
  [rx(String.raw`switch HP with opponent`),                          ()=>[{type:'swapHp'}]],
  // ---- voids and specialty changes
  [rx(String.raw`opponent'?s support and option effects are voided`), ()=>[{type:'voidOppSupport', options:true}]],
  [rx(String.raw`opponent'?s support effects? (?:is|are) voided`),   ()=>[{type:'voidOppSupport', options:false}]],
  [rx(String.raw`changes? own specialty to {SP}`),                   m=>[{type:'setOwnSpec', spec:normSpecWord(m[1])}]],
  [rx(String.raw`changes? (?:opponent'?s|foe'?s) specialty to {SP}`), m=>[{type:'setOppSpec', spec:normSpecWord(m[1])}]],
  [rx(String.raw`changes? both players'? specialt(?:y|ies) to {SP}`), m=>[{type:'setBothSpec', spec:normSpecWord(m[1])}]],
  [rx(String.raw`swap own specialty with opponent'?s specialty`),    ()=>[{type:'swapSpec'}]],
  [rx(String.raw`opponent'?s specialty becomes same as own specialty`), ()=>[{type:'copyOwnSpecToOpp'}]],
];
// Texts that never matter to the damage / HP maths: digivolution rules and revival text
// (a revived Digimon still loses the bout), plus clause-level upkeep next to a real effect
// (deck, hand and DP-slot changes). Whatever is left after the rules and these has
// combat-sounding words in it gets reported as unmodelled.
const WHOLE_IGNORE = [
  /^can (?:digivolve|disregard)\b/i, /^digivolve a\b/i, /^downgrade\b/i, /^hp doubles if successful/i,
  /^(?:no effect|none)\b/i, /^(?:digimon )?ko'?d\b/i, /^battle is still lost/i
];
const CLAUSE_IGNORE = [
  /^(?:randomly )?discard\b/i, /^(?:opponent|foe) discards\b/i, /^both players discard\b/i, /^draw\b/i,
  /^(?:move|return|pick|look|shuffle)\b/i
];
const COMBAT_WORDS = /attack|power|\bHP\b|specialty|level|void|counter|first|second|swap|copy|recover|boost|lower|reduce|doubl|halv|tripl|multipl|\badd\b|switch/i;

function parseEffectBody(body){
  if(WHOLE_IGNORE.some(r=>r.test(body.trim()))) return {found:[], left:[]};
  let work = ' '+body+' ';
  const found = [];
  EFFECT_RULES.forEach(([re, make])=>{
    let m, guard = 0;
    while((m = re.exec(work)) && guard++ < 5){
      make(m).forEach(t=>found.push(t));
      work = work.slice(0, m.index) + ' ' + work.slice(m.index + m[0].length);
    }
  });
  const left = work.split(/[,;&]| and | then /i).map(s=>s.replace(/\s+/g,' ').replace(/^[\s.'"]+|[\s.'"]+$/g,''))
    .filter(s=>s && COMBAT_WORDS.test(s) && !CLAUSE_IGNORE.some(r=>r.test(s)));
  return {found, left};
}

const _effectParseCache = new Map();
function parseEffectTags(text, card){
  const tags = []; tags.unmodelled = [];
  if(!text) return tags;
  const fromOption = !!(card && card.type==='option');
  const key = (fromOption?'o|':'d|')+text;
  const hit = _effectParseCache.get(key);
  if(hit) return hit;
  splitEffectSentences(normEffectText(text)).forEach(sentence=>{
    let cond = null, body = sentence;
    const mc = /^if\s+(.+?),\s*(.+)$/i.exec(sentence);
    if(mc){ cond = parseEffectCondition(mc[1]); body = mc[2]; }
    const {found, left} = parseEffectBody(body);
    if(cond && cond.kind==='unknown'){ if(found.length || left.length) tags.unmodelled.push(sentence); return; }
    found.forEach(t=>{ if(cond) t.condition = cond; t.fromOption = fromOption; tags.push(t); });
    left.forEach(l=>tags.unmodelled.push(l));
  });
  _effectParseCache.set(key, tags);
  return tags;
}

// ======================= BOUT ENGINE =======================
// Own-attack modifiers run in tag order on a running value; effects aimed at the other
// player's attack are a second pass. Order matches the original solver: my aimed effects
// hit the opponent's number BEFORE their own boosts apply, theirs hit mine AFTER.
function applyOwnMods(tags, atk, v){
  tags.forEach(t=>{
    switch(t.type){
      case 'boostOwnAttack': v += t.amount; break;
      case 'boostOwnAttackSpecific': if(t.attack===atk) v += t.amount; break;
      case 'doubleOwnAttack': if(t.attack===atk) v *= 2; break;
      case 'multiplyOwnAttack': if(!t.attack || t.attack===atk) v *= t.mult; break;
      case 'setOwnAttack': v = t.value; break;
      case 'zeroOwnAttack': if(t.attack===atk) v = 0; break;
    }
  });
  return v;
}
function applyAimedMods(tags, victimAtk, v){
  tags.forEach(t=>{
    const hit = !t.attack || t.attack===victimAtk;
    switch(t.type){
      case 'zeroOppAttack': if(hit) v = 0; break;
      case 'setOppAttack': if(hit) v = t.value; break;
      case 'capOppAttack': if(hit) v = Math.min(v, t.value); break;
      case 'lowerOppAttack': if(hit) v = Math.max(0, v - t.amount); break;
      case 'scaleOppAttack': v *= t.mult; break;
    }
  });
  return v;
}

// One bout, resolved the way the game plays it:
//  1. Conditional support effects are checked against the cards/HP/attacks as chosen.
//  2. Voids / jamming, forced attacks and specialty changes are applied.
//  3. Support effects that change HP (heal, halve, "HP becomes", HP swap) land BEFORE
//     the attacks, so a heal can lift a Digimon out of KO range and a halving can drop
//     it into it (support effects resolve before the bout begins -- confirmed by play).
//  4. The first attacker strikes; if that KOs the other Digimon it never gets to attack.
//     Eat-up HP heals and Crash's "HP becomes 10" happen as part of the attacker's own
//     strike, so Crash leaves the attacker on 10 HP for whatever hits it next.
// Returns damage as executed, KO flags and the HP each side ends the bout on.
function computeCell(myCard, oppCard, myHp, oppHp, a, b, mySupportTags, oppSupportTags, hiddenBuffer, iAmTurnPlayer){
  mySupportTags = mySupportTags||[]; oppSupportTags = oppSupportTags||[]; hiddenBuffer = hiddenBuffer||0;
  const origA = a, origB = b, myHp0 = myHp, oppHp0 = oppHp;

  // 1. conditions
  const myX  = {own:myCard,  foe:oppCard, ownHp:myHp0,  foeHp:oppHp0, ownAtk:origA, foeAtk:origB};
  const oppX = {own:oppCard, foe:myCard,  ownHp:oppHp0, foeHp:myHp0,  ownAtk:origB, foeAtk:origA};
  let myT  = mySupportTags.filter(t=>tagActive(t, myX));
  let oppT = oppSupportTags.filter(t=>tagActive(t, oppX));

  // 2a. voids -- "support effect" voids Digimon-card supports only, "support and option" voids both
  const myVoid = myT.filter(t=>t.type==='voidOppSupport'), oppVoid = oppT.filter(t=>t.type==='voidOppSupport');
  if(oppVoid.length) myT  = oppVoid.some(v=>v.options) ? [] : myT.filter(t=>t.fromOption);
  if(myVoid.length)  oppT = myVoid.some(v=>v.options)  ? [] : oppT.filter(t=>t.fromOption);
  // Jamming: "Opponent's Support Effect is Voided. Can't Void Option Effect." Only triggers
  // when its owner presses Cross, like every other xt ability.
  if(a==='x' && xtGrantsJamming(myCard.xt))  oppT = oppT.filter(t=>t.fromOption);
  if(b==='x' && xtGrantsJamming(oppCard.xt)) myT  = myT.filter(t=>t.fromOption);

  // 2b. forced / locked attacks
  myT.concat(oppT).forEach(t=>{ if(t.type==='forceBothAttack'){ a = t.attack; b = t.attack; } });
  myT.forEach(t=>{  if(t.type==='forceOppAttack') b = t.attack; if(t.type==='lockOwnAttack') a = t.attack; });
  oppT.forEach(t=>{ if(t.type==='forceOppAttack') a = t.attack; if(t.type==='lockOwnAttack') b = t.attack; });

  // 2c. specialty changes (feed the "<Specialty> foe x3" Cross bonuses)
  let mySp = myCard.sp, oppSp = oppCard.sp;
  [[myT,true],[oppT,false]].forEach(([tags, mine])=>{
    tags.forEach(t=>{
      if(t.type==='setOwnSpec'){ if(mine) mySp = t.spec; else oppSp = t.spec; }
      else if(t.type==='setOppSpec'){ if(mine) oppSp = t.spec; else mySp = t.spec; }
      else if(t.type==='setBothSpec'){ mySp = t.spec; oppSp = t.spec; }
      else if(t.type==='swapSpec'){ const tmp = mySp; mySp = oppSp; oppSp = tmp; }
      else if(t.type==='copyOwnSpecToOpp'){ if(mine) oppSp = mySp; else mySp = oppSp; }
    });
  });
  const myE  = mySp===myCard.sp   ? myCard  : Object.assign({}, myCard,  {sp:mySp});
  const oppE = oppSp===oppCard.sp ? oppCard : Object.assign({}, oppCard, {sp:oppSp});

  // 3. support effects that change HP, before any attack
  let hpMe = myHp0, hpOpp = oppHp0, myHalve = false, oppHalve = false;
  const hpNotes = [], ops = [];
  [[myT,'me'],[oppT,'opp']].forEach(([tags, who])=>{
    const foe = who==='me' ? 'opp' : 'me';
    tags.forEach(t=>{
      switch(t.type){
        case 'swapHp':          ops.push({k:0}); break;
        case 'setSelfHp':       ops.push({k:1, who, v:t.amount}); break;
        case 'setOppHp':        ops.push({k:1, who:foe, v:t.amount}); break;
        case 'copyOppHpToSelf': ops.push({k:2, to:who, from:foe}); break;
        case 'copySelfHpToOpp': ops.push({k:2, to:foe, from:who}); break;
        case 'halveSelfHp':     ops.push({k:3, who, f:0.5}); break;
        case 'halveOppHp':      ops.push({k:3, who:foe, f:0.5}); break;
        case 'doubleOppHp':     ops.push({k:3, who:foe, f:2}); break;
        case 'healSelf':        ops.push({k:4, who, v:t.amount}); break;
        case 'healOpp':         ops.push({k:4, who:foe, v:t.amount}); break;
      }
    });
  });
  const who2 = w=>w==='me' ? 'your' : "opponent's";
  ops.filter(o=>o.k===0).forEach(()=>{ const t = hpMe; hpMe = hpOpp; hpOpp = t; hpNotes.push('HP was swapped'); });
  ops.filter(o=>o.k===1).forEach(o=>{ if(o.who==='me') hpMe = o.v; else hpOpp = o.v; hpNotes.push(`${who2(o.who)} HP became ${o.v}`); });
  ops.filter(o=>o.k===2).forEach(o=>{ const v = o.from==='me' ? hpMe : hpOpp; if(o.to==='me') hpMe = v; else hpOpp = v; hpNotes.push(`${who2(o.to)} HP became ${v}`); });
  ops.filter(o=>o.k===3).forEach(o=>{
    if(o.who==='me'){ hpMe = Math.floor(hpMe*o.f); if(o.f<1) myHalve = true; } else { hpOpp = Math.floor(hpOpp*o.f); if(o.f<1) oppHalve = true; }
    hpNotes.push(`${who2(o.who)} HP ${o.f<1 ? 'was halved' : 'was doubled'}`);
  });
  let myHealAmt = 0, oppHealAmt = 0;
  ops.filter(o=>o.k===4).forEach(o=>{
    if(o.who==='me'){ hpMe += o.v; myHealAmt += o.v; hpNotes.push(`you recovered ${o.v} HP`); }
    else { hpOpp += o.v; oppHealAmt += o.v; hpNotes.push(`opponent recovered ${o.v} HP`); }
  });

  // 4. attack numbers
  let bothBoost = 0, zeroBoth = false;
  myT.concat(oppT).forEach(t=>{ if(t.type==='boostBothAttack') bothBoost += t.amount; if(t.type==='zeroBothAttack') zeroBoth = true; });

  // Value-only redirects (e.g. Disrupt Ray): change which damage NUMBER is used without
  // changing which attack was actually "pressed" -- own-attack-triggered abilities
  // (negation, foe multipliers, first strike) still key off a/b as-is.
  let aVal = a, bVal = b;
  myT.forEach(t=>{  if(t.type==='redirectOtherAttackValue') bVal = t.map[b]; });
  oppT.forEach(t=>{ if(t.type==='redirectOtherAttackValue') aVal = t.map[a]; });

  // Counter Attack: "If Opponent uses [X] Attack, it will miss. Then you counter with
  // opponent's [X] attack power." Only live when its owner presses Cross (hence these
  // cards print X:0 -- that's the whiff fallback when the opponent doesn't pick the match).
  const myCounter = a==='x' ? parseCounterTag(myCard.xt) : null;
  const oppCounter = b==='x' ? parseCounterTag(oppCard.xt) : null;
  const myCountering = !!myCounter && myCounter.toLowerCase()===b;
  const oppCountering = !!oppCounter && oppCounter.toLowerCase()===a;

  // HP-based attacks use the attacker's HP at the moment it strikes: Crash ("Attack Power
  // becomes same as HP. HP becomes 10."), "attack power is same as HP", Mega Hand.
  const myCrashing = a==='x' && isCrashXTag(myCard.xt);
  const oppCrashing = b==='x' && isCrashXTag(oppCard.xt);
  const myHpTag  = myT.find(t=>t.type==='ownAttackEqualsHp' && (!t.attack || t.attack===a));
  const oppHpTag = oppT.find(t=>t.type==='ownAttackEqualsHp' && (!t.attack || t.attack===b));
  const myHpBased = !myCountering && (myCrashing || !!myHpTag);
  const oppHpBased = !oppCountering && (oppCrashing || !!oppHpTag);
  const myEatUp  = (a==='x' && isEatUpHpXTag(myCard.xt))  || myT.some(t=>t.type==='eatUpHp');
  const oppEatUp = (b==='x' && isEatUpHpXTag(oppCard.xt)) || oppT.some(t=>t.type==='eatUpHp');

  const baseMy  = myCountering  ? baseVal(oppE, b) : effectiveDamage(myE,  a, oppE, aVal);
  const baseOpp = oppCountering ? baseVal(myE,  a) : effectiveDamage(oppE, b, myE,  bVal);

  // Final zeroes: a counter makes the matching attack miss, "O/T/X to 0" negation, Shogun's Order
  let myNeg = false, oppNeg = false;
  if(a==='x'){ const neg = parseNegateTag(myCard.xt);  if(neg && neg.toLowerCase()===b) oppNeg = true; }
  if(b==='x'){ const neg = parseNegateTag(oppCard.xt); if(neg && neg.toLowerCase()===a) myNeg = true; }
  const oppFinalZero = zeroBoth || myCountering || oppNeg;
  const myFinalZero  = zeroBoth || oppCountering || myNeg;
  const fin = v=>Math.max(0, Math.round(v));
  const myDmgFor  = base=> myFinalZero  ? 0 : fin(applyAimedMods(oppT, a, applyOwnMods(myT,  a, base + bothBoost)));
  const oppDmgFor = base=> oppFinalZero ? 0 : fin(applyOwnMods(oppT, b, applyAimedMods(myT, b, base + bothBoost)));

  // First-strike: the turn player goes first by default. The non-turn player can steal
  // that only if the turn player does NOT also have a "1st Attack" trait -- per the
  // official text, having it yourself voids a foe's steal attempt even though it's
  // otherwise redundant for whoever already goes first.
  const iCanSteal = activeGrantsFirstStrike(myCard, a) || myT.some(t=>t.type==='firstStrike');
  const oppCanSteal = activeGrantsFirstStrike(oppCard, b) || oppT.some(t=>t.type==='firstStrike');
  let myGoesFirst;
  if(iAmTurnPlayer===undefined || iAmTurnPlayer===null){
    myGoesFirst = iCanSteal && !oppCanSteal ? true : (!iCanSteal && oppCanSteal ? false : null);
  } else {
    const turnPlayerHasFirst = iAmTurnPlayer ? iCanSteal : oppCanSteal;
    const nonTurnPlayerHasFirst = iAmTurnPlayer ? oppCanSteal : iCanSteal;
    const turnPlayerGoesFirst = !(nonTurnPlayerHasFirst && !turnPlayerHasFirst);
    myGoesFirst = iAmTurnPlayer ? turnPlayerGoesFirst : !turnPlayerGoesFirst;
  }

  // 5. the exchange
  const hp = {me:hpMe, opp:hpOpp};
  let dealtMe = 0, dealtOpp = 0, lifeMe = 0, lifeOpp = 0, crashMe = null, crashOpp = null;
  function afterStrike(att, dmg){
    const me = att==='me';
    if(me ? myEatUp : oppEatUp){ hp[att] += dmg; if(me) lifeMe += dmg; else lifeOpp += dmg; }
    if(me ? myCrashing : oppCrashing){ hp[att] = 10; if(me) crashMe = 10; else crashOpp = 10; }
    else if((me ? myHpTag : oppHpTag) && (me ? myHpTag : oppHpTag).thenHalve){ hp[att] = Math.floor(hp[att]/2); }
  }
  function strike(att, hpAtStrike){
    const me = att==='me';
    const base = (me ? myHpBased : oppHpBased) ? hpAtStrike : (me ? baseMy : baseOpp);
    let dmg = me ? myDmgFor(base) : oppDmgFor(base) + hiddenBuffer;
    if(me){ hp.opp = Math.max(0, hp.opp - dmg); dealtMe = dmg; } else { hp.me = Math.max(0, hp.me - dmg); dealtOpp = dmg; }
    afterStrike(att, dmg);
  }
  if(myGoesFirst===null){
    // Order unknown: both strikes land from the same starting HP.
    const sm = hp.me, so = hp.opp;
    const dm = myDmgFor(myHpBased ? sm : baseMy), dop = oppDmgFor(oppHpBased ? so : baseOpp) + hiddenBuffer;
    hp.opp = Math.max(0, so - dm); hp.me = Math.max(0, sm - dop); dealtMe = dm; dealtOpp = dop;
    afterStrike('me', dm); afterStrike('opp', dop);
  } else {
    const order = myGoesFirst ? ['me','opp'] : ['opp','me'];
    strike(order[0], hp[order[0]]);
    if(hp[order[1]] > 0) strike(order[1], hp[order[1]]);
  }
  if(lifeMe) hpNotes.push(`you recovered ${lifeMe} HP (Eat-up HP)`);
  if(lifeOpp) hpNotes.push(`opponent recovered ${lifeOpp} HP (Eat-up HP)`);
  if(crashMe!=null) hpNotes.push(`your HP became ${crashMe} (Crash)`);
  if(crashOpp!=null) hpNotes.push(`opponent's HP became ${crashOpp} (Crash)`);

  return {
    myDmg:dealtMe, oppDmg:dealtOpp, koOpp:hp.opp<=0, koMe:hp.me<=0, myAtk:a, oppAtk:b,
    myTagsUsed:myT.map(t=>t.type), oppTagsUsed:oppT.map(t=>t.type),
    myHpBefore:myHp0, oppHpBefore:oppHp0, myHpAfter:hp.me, oppHpAfter:hp.opp,
    myHealAmt:myHealAmt+lifeMe, oppHealAmt:oppHealAmt+lifeOpp, myHalve, oppHalve, mySetHp:crashMe, oppSetHp:crashOpp, hpNotes
  };
}

function computeMatrix(myCard, oppCard, myHp, oppHp, mySupportTags, hiddenBuffer, iAmTurnPlayer){
  const atks=['o','t','x'];
  const grid = {};
  atks.forEach(a=>{ grid[a]={}; atks.forEach(b=>{
    grid[a][b] = computeCell(myCard, oppCard, myHp, oppHp, a, b, mySupportTags, [], hiddenBuffer, iAmTurnPlayer);
  }); });
  return grid;
}

// ======================= KO-AWARE SCORING =======================
// A match is won by causing 3 KOs, so a bout is scored on the HP swing it produces AND on
// whether it KOs either Digimon. A KO is worth more the closer that side is to 3 (and
// decisive at 2). The numbers are in "HP swing" units, on top of the HP the KO itself
// removes: ~2000 means one KO is worth about a big Digimon's whole HP bar. These are the
// knobs to tune after play-testing -- raise `base` to play safer, lower it to trade
// KO risk for raw damage. The swing comes from the HP each side actually ends the bout
// on, so damage past a Digimon's remaining HP isn't counted and heals / halving /
// Crash's HP cost all are.
const KO_STAKES = { base:2000, perKO:500, decisive:100000 };
function koStakes(){
  const s = (typeof B!=='undefined' && B) ? B : {};
  const mine = Math.min(s.myScore||0, 2), theirs = Math.min(s.oppScore||0, 2);
  return {
    gain: mine>=2   ? KO_STAKES.decisive : KO_STAKES.base + KO_STAKES.perKO*mine,   // my KO wins the match at 2
    loss: theirs>=2 ? KO_STAKES.decisive : KO_STAKES.base + KO_STAKES.perKO*theirs  // their KO wins it at 2
  };
}
function cellSwing(cell){ return (cell.myHpAfter - cell.myHpBefore) - (cell.oppHpAfter - cell.oppHpBefore); }
function cellScore(cell, st){
  st = st || koStakes();
  return cellSwing(cell) + (cell.koOpp ? st.gain : 0) - (cell.koMe ? st.loss : 0);
}
// When two options have the same worst case, the one that does better across the opponent's
// possible replies wins. The CPU doesn't look random (some of its picks look calculated), but
// until the exported logs show a pattern every attack is treated as equally likely, and only for
// this tie-break -- the worst case still decides first. Set a weight to 0 for an attack the CPU
// never picks.
const OPP_ATTACK_WEIGHTS = {o:1, t:1, x:1};
// cells: every outcome the opponent can steer towards for ONE option of mine; ws: how likely each is.
function outcomeOf(cells, st, ws){
  let w = null, worst = Infinity, sum = 0, tot = 0;
  cells.forEach((c,i)=>{
    const sc = cellScore(c, st), wt = ws ? ws[i] : 1;
    if(sc<worst){ worst = sc; w = c; }
    sum += sc*wt; tot += wt;
  });
  const mean = tot ? sum/tot : worst;
  // scores are whole numbers, so the tie-break term can never outweigh a real difference
  return { worst, mean, key:worst + mean*1e-6, swing:cellSwing(w), koMe:w.koMe, koOpp:w.koOpp };
}

function maximin(grid){
  const atks=['o','t','x'], st = koStakes(), ws = atks.map(b=>OPP_ATTACK_WEIGHTS[b]);
  let best=null, bestKey=-Infinity, bestO=null;
  atks.forEach(a=>{
    const o = outcomeOf(atks.map(b=>grid[a][b]), st, ws);
    if(o.key>bestKey){ bestKey = o.key; best = a; bestO = o; }
  });
  return { best, bestVal:bestO.worst, bestMean:bestO.mean, bestKey, bestSwing:bestO.swing, bestKoMe:bestO.koMe, bestKoOpp:bestO.koOpp };
}

function rankSupportOptions(myCard, oppCard, myHp, oppHp, fixedA, hand, oppSupportTagsKnown, hiddenBuffer, iAmTurnPlayer){
  const st = koStakes(), ws = ['o','t','x'].map(b=>OPP_ATTACK_WEIGHTS[b]);
  const candidates = [{id:'', name:'— none —', tags:[]}].concat(
    hand.map(c=>({id:String(c._uid||c.id), name:c.name + (c.type==='option'?' (option)':''), tags:parseEffectTags(effectText(c), c)}))
  );
  return candidates.map(cand=>{
    const cells = ['o','t','x'].map(b=>computeCell(myCard, oppCard, myHp, oppHp, fixedA, b, cand.tags, oppSupportTagsKnown||[], hiddenBuffer||0, iAmTurnPlayer));
    return Object.assign({ id:cand.id, name:cand.name, partial:!!(cand.tags.unmodelled||[]).length }, outcomeOf(cells, st, ws));
  }).sort((x,y)=>y.key-x.key);
}

// Display helpers shared by the ranking lists: the HP swing of the worst case, plus a
// tag when that worst case involves a KO either way.
function fmtOutcome(swing, koMe, koOpp, approx){
  let s = (approx?'~':'')+(swing>=0?'+':'')+swing;
  if(koOpp) s += ' <span style="color:var(--nature)">KO</span>';
  if(koMe) s += ' <span style="color:var(--red)">KO risk</span>';
  return s;
}
function partialMark(partial){
  return partial ? ' <span class="small-note" title="Part of this card\u2019s effect text isn\u2019t modeled by the solver yet, so its score may be off.">\u26A0 partly modeled</span>' : '';
}

function halveToNearestTen(val){ return Math.floor(val/20)*10; }
function quarterToNearestTen(val){ return Math.floor(val/40)*10; }

function adjustForEntrance(card){
  if(card.lvl==='C'){
    return Object.assign({}, card, {
      hp:halveToNearestTen(card.hp), o:halveToNearestTen(card.o), t:halveToNearestTen(card.t), x:halveToNearestTen(card.x),
      _halved:true, _entryPenalty:'half'
    });
  }
  if(card.lvl==='U'){
    return Object.assign({}, card, {
      hp:quarterToNearestTen(card.hp), o:quarterToNearestTen(card.o), t:quarterToNearestTen(card.t), x:quarterToNearestTen(card.x),
      _halved:true, _entryPenalty:'quarter'
    });
  }
  return Object.assign({}, card, {_halved:false, _entryPenalty:null});
}

function effectQualityNote(card){
  let score = 0; const notes = [];
  const xt = (card.xt||'').trim();
  const counterLetter = parseCounterTag(xt);
  if(parseNegateTag(xt)){ score+=150; notes.push(`Cross negates the opponent's ${parseNegateTag(xt)} entirely.`); }
  else if(counterLetter){ score+=90; notes.push(`Cross counters the opponent's ${counterLetter} specifically — negates it and reflects their own ${counterLetter} power back at them (whiffs otherwise, hence X:0).`); }
  else if(isFirstStrikeXTag(xt)){ score+=100; notes.push('Cross grants first-attack priority (valuable if you end up as the non-turn player).'); }
  else if(parseFoeMultiplier(xt)){ const fm=parseFoeMultiplier(xt); score+=50; notes.push(`Cross triples damage vs ${fm.spec} opponents (situational).`); }
  else if(isEatUpHpXTag(xt)){ score+=70; notes.push('Cross heals you for exactly the damage it deals (lifesteal).'); }
  else if(isCrashXTag(xt)){ score+=40; notes.push('Cross deals damage equal to your current HP, then your HP becomes 10 — huge swing, huge risk.'); }
  else if(xtGrantsJamming(xt)){ score+=45; notes.push("Cross voids the opponent's Digimon-card support effect this bout (not Option cards)."); }
  else if(xt && xt.toLowerCase()!=='none'){ notes.push(`Cross effect: "${xt}" (situational, not auto-scored).`); }

  const txt = effectText(card);
  const supTags = parseEffectTags(txt, card);
  supTags.forEach(t=>{
    // A condition only sometimes holds, so a conditional effect counts for half.
    const w = t.condition ? 0.5 : 1, cond = t.condition ? ' (conditional)' : '';
    if(t.type==='zeroOppAttack'){ score+=100*w; notes.push('Support can zero an opponent attack outright'+cond+'.'); }
    if(t.type==='doubleOwnAttack'){ score+=70*w; notes.push('Support can double one of its own attacks'+cond+'.'); }
    if(t.type==='boostOwnAttack'){ score+=w*t.amount/5; notes.push(t.amount<0 ? `Support lowers all its attacks by ${-t.amount}${cond}.` : `Support boosts all attacks by +${t.amount}${cond}.`); }
    if(t.type==='boostOwnAttackSpecific'){ score+=w*t.amount/8; notes.push(`Support boosts its ${(t.attack||'?').toUpperCase()} by +${t.amount}${cond}.`); }
    if(t.type==='healSelf'){ score+=w*t.amount/6; notes.push(`Support heals +${t.amount} HP${cond}.`); }
    if(t.type==='halveSelfHp'){ score-=80*w; notes.push('Support halves own HP — risky'+cond+'.'); }
    if(t.type==='halveOppHp'){ score+=60*w; notes.push('Support halves opponent HP'+cond+'.'); }
    if(t.type==='zeroOwnAttack'){ score-=30*w; notes.push(`Support zeroes its own ${(t.attack||'?').toUpperCase()} attack${cond}.`); }
    if(t.type==='forceBothAttack'){ score+=20*w; notes.push(`Support forces both players onto ${(t.attack||'?').toUpperCase()} — situational${cond}.`); }
  });
  if(/draw \d* ?cards?/i.test(txt)){ score+=30; notes.push('Support draws a card — card advantage.'); }
  return {score, notes};
}

// ======================= DIGIVOLVE PATHS, ENTRANCE AND DP ADVICE =======================
// Digivolving swaps your HP for the new form's FULL HP and restores its full stats (manual p.16),
// so a Digimon with a route up has a built-in refill to fall back on. These helpers put a number
// on that route so entrance, sacrifice and digivolve advice can all see it. Units are the same
// "heuristic points" as the rest of the entrance score (10 HP or 5 attack power = 1 point).
function avgAtkOf(c){ return Math.round(((c.o||0)+(c.t||0)+(c.x||0))/3); }
// How much a path is trusted: ready now, covered by a Speed-Digivolve, one more sacrifice away, or further off.
const PATH_RELIABILITY = { now:1, speed:1, near:0.6, far:0.4 };
// With a real matchup the entrance score is in HP-swing units, so one path point is worth this much swing.
const PATH_SWING = 5;
function digivolvePath(card, hand, dp){
  const none = {value:0, target:null, reach:'none', gap:0};
  const order = {R:0,C:1,U:2};
  if(!card || !(card.lvl in order) || card.lvl==='U') return none;
  const speed = hasSpeedDigivolveCard(hand);
  let best = none;
  hand.forEach(c=>{
    if(c.type!=='digimon' || c.sp!==card.sp || !(c.lvl in order) || order[c.lvl]!==order[card.lvl]+1) return;
    const gap = Math.max(0, (c.dp||0) - (dp||0));
    const reach = gap===0 ? 'now' : (speed ? 'speed' : 'later');
    const rel = reach==='later' ? (gap<=20 ? PATH_RELIABILITY.near : PATH_RELIABILITY.far) : 1;
    const value = Math.round(rel * (c.hp/10 + Math.max(0, avgAtkOf(c)-avgAtkOf(card))/5));
    if(value>best.value) best = {value, target:c, reach, gap};
  });
  return best;
}
function pathNote(path){
  const how = path.reach==='now' ? 'you already have the DP' : (path.reach==='speed' ? 'Speed-Digivolve covers the DP' : `needs ${path.gap} more DP`);
  return `Route up: ${path.target.name} (${how}) — digivolving refills you to ${path.target.hp} HP with full stats.`;
}

// ---- sacrifice advisor tuning. A sacrificed card is replaced by a draw (your hand refills to 4, and
// the CPU sacrifices nearly every turn), so what it costs is only how much better it is than a typical
// replacement -- not its whole value.
const SAC = { costWeight:0.6, fallbackBaseline:130 };
function cardValue(c){ return Math.round(c.hp/10 + avgAtkOf(c)/5 + effectQualityNote(c).score); }
function replacementBaseline(){
  const rem = getRemainingDeckList().filter(r=>r.card.type==='digimon');
  if(!rem.length) return SAC.fallbackBaseline;
  let sum = 0, n = 0;
  rem.forEach(r=>{ sum += cardValue(r.card)*r.count; n += r.count; });
  return Math.round(sum/n);
}

// ---- digivolve timing. You only get a DP phase every other bout, and the opponent strikes in both bouts
// before your next one, so the question is whether they can KO you inside that window.
function threatOf(oppActive, myActive){
  if(!oppActive || !myActive) return 0;
  return Math.max.apply(null, ['o','t','x'].map(a=>effectiveDamage(oppActive, a, myActive, a)));
}
function digivolveAdvice(active, hp, oppActive, target){
  if(!oppActive) return { now:null, text:"Their Digimon isn't known yet, so there's nothing to weigh against. Digivolving refills you to the new form's full HP, which is worth the most when you're low." };
  const threat = threatOf(oppActive, active), refill = target ? ` ${target.name} would refill you to ${target.hp}.` : '';
  if(hp<=threat)   return { now:true,  threat, text:`Their strongest attack (${threat}) can KO you from ${hp} HP — digivolve now.${refill}` };
  if(hp<=2*threat) return { now:true,  threat, text:`Two of their hits (${threat} each) would KO you from ${hp} HP before your next DP phase — digivolving now is the safe play.${refill}` };
  return { now:false, threat, text:`You can take two of their hits (${threat} each) from ${hp} HP before your next DP phase — holding keeps the refill for when you're low.${refill}` };
}
function adviceHtml(adv, holdLabel){
  if(!adv) return '';
  const head = adv.now===null ? '' : (adv.now ? 'Recommended: <b>digivolve now</b>. ' : 'Recommended: <b>'+(holdLabel||'hold')+'</b>. ');
  return `<div class="reason">${head}${adv.text}</div>`;
}

function rankEntranceCandidates(hand, oppActive, oppHp, dp){
  if(dp==null) dp = (typeof B!=='undefined' && B) ? (B.myDpTotal||0) : 0;
  const candidates = hand.filter(c=>c.type==='digimon').map(c=>adjustForEntrance(c));
  return candidates.map(card=>{
    const uid = String(card._uid||card.id);
    const rest = hand.filter(c=>String(c._uid||c.id)!==uid);
    const path = digivolvePath(card, rest, dp);
    const eff = effectQualityNote(card);
    let matchupVal = null, matchupKey = null, mu = null;
    if(oppActive){
      const grid = computeMatrix(card, oppActive, card.hp, (oppHp!=null?oppHp:oppActive.hp), [], 0, true);
      mu = maximin(grid); matchupVal = mu.bestVal; matchupKey = mu.bestKey + path.value*PATH_SWING;
    }
    const avgAtk = avgAtkOf(card);
    const heuristic = Math.round(card.hp/10 + avgAtk/5 + eff.score + path.value);
    const notes = eff.notes.slice();
    if(path.target) notes.unshift(pathNote(path));
    return { card, matchupVal, matchupKey, matchupSwing:mu&&mu.bestSwing, matchupKoMe:mu&&mu.bestKoMe, matchupKoOpp:mu&&mu.bestKoOpp,
             heuristic, notes, avgAtk, path:{value:path.value, target:path.target?path.target.name:null, reach:path.reach, gap:path.gap} };
  }).sort((a,b)=>{
    if(a.matchupKey!==null && b.matchupKey!==null) return b.matchupKey-a.matchupKey;
    return b.heuristic-a.heuristic;
  });
}

function rankSupportOptionsOpenInfo(myCard, oppCard, myHp, oppHp, fixedA, myHand, oppHandCards, iAmTurnPlayer){
  const st = koStakes();
  const myCandidates = [{id:'', name:'— none —', tags:[]}].concat(
    myHand.map(c=>({id:String(c._uid||c.id), name:c.name + (c.type==='option'?' (option)':''), tags:parseEffectTags(effectText(c), c)}))
  );
  const oppSupportCandidates = [[]].concat(
    (oppHandCards||[]).map(c=>parseEffectTags(effectText(c), c))
  );
  return myCandidates.map(cand=>{
    const cells = [], wts = [];
    ['o','t','x'].forEach(b=>{
      oppSupportCandidates.forEach(oppTags=>{
        cells.push(computeCell(myCard, oppCard, myHp, oppHp, fixedA, b, cand.tags, oppTags, 0, iAmTurnPlayer));
        wts.push(OPP_ATTACK_WEIGHTS[b] / oppSupportCandidates.length);
      });
    });
    return Object.assign({ id:cand.id, name:cand.name, partial:!!(cand.tags.unmodelled||[]).length }, outcomeOf(cells, st, wts));
  }).sort((x,y)=>y.key-x.key);
}

// Expected value of playing a random card from what's actually left in your
// selected deck -- weighted by remaining count, using worst-case-vs-opponent
// for each possible random draw (randomness on your side => expectation is
// the right lens; the opponent's response is still treated adversarially).
// oppSupportSets: either a single known tag array, or an array of possible
// tag arrays (e.g. from their tracked hand) to treat as opponent options too.
function randomCardExpectedValue(myCard, oppCard, myHp, oppHp, fixedA, oppSupportSets, hiddenBuffer, iAmTurnPlayer){
  const remaining = getRemainingDeckList();
  if(!remaining.length) return null;
  const st = koStakes();
  const sets = (oppSupportSets.length && Array.isArray(oppSupportSets[0])) ? oppSupportSets : [oppSupportSets||[]];
  const total = remaining.reduce((s,r)=>s+r.count, 0);
  let sumScore = 0, sumSwing = 0, sumMean = 0, koMeCount = 0;
  remaining.forEach(({card, count})=>{
    const tags = parseEffectTags(effectText(card), card);
    const cells = [], wts = [];
    ['o','t','x'].forEach(b=>{
      sets.forEach(oppTags=>{
        cells.push(computeCell(myCard, oppCard, myHp, oppHp, fixedA, b, tags, oppTags, hiddenBuffer||0, iAmTurnPlayer));
        wts.push(OPP_ATTACK_WEIGHTS[b] / sets.length);
      });
    });
    const o = outcomeOf(cells, st, wts);
    sumScore += o.worst * count; sumSwing += o.swing * count; sumMean += o.mean * count; if(o.koMe) koMeCount += count;
  });
  const ev = sumScore/total, evMean = sumMean/total;
  return { ev: Math.round(ev), evMean: Math.round(evMean), key: ev + evMean*1e-6, evSwing: Math.round(sumSwing/total), koMeShare: koMeCount/total, poolSize: total };
}

// ============================= DECK GENERATION =============================
// Heuristic, not a proven-optimal solver: scores owned cards by combat value
// plus a "specialty depth" bonus (more owned cards in one specialty = more
// likely to have real digivolve-chain coverage there), always includes owned
// Partner-line cards, then fills toward a ~23 Digimon / ~7 Option split
// (roughly matching a typical starter deck's ratio) while respecting owned counts.
function scoreDigimonForDeck(card, specialtyDepth){
  const eff = effectQualityNote(card);
  const avgAtk = (card.o+card.t+card.x)/3;
  const clusterBonus = Math.min(30, (specialtyDepth[card.sp]||0) * 3);
  return Math.round(card.hp/10 + avgAtk/5 + eff.score + clusterBonus);
}
function scoreOptionForDeck(card){
  const eff = effectQualityNote(card);
  return eff.score;
}

// A deck can hold at most four copies of any one card, however many you own (manual p.21).
const MAX_DECK_COPIES = 4;
function generateOptimalDeck(collection, targetSize){
  targetSize = targetSize || 30;
  const owned = Object.keys(collection).filter(id=>collection[id]>0)
    .map(id=>ALL_CARDS.find(c=>String(c.id)===String(id))).filter(Boolean);

  const specialtyDepth = {};
  owned.filter(c=>c.type==='digimon' && c.sp!=='Partner').forEach(c=>{
    specialtyDepth[c.sp] = (specialtyDepth[c.sp]||0) + collection[c.id];
  });

  const partnerCards = owned.filter(c=>c.type==='digimon' && c.sp==='Partner');
  const digimonCards = owned.filter(c=>c.type==='digimon' && c.sp!=='Partner')
    .map(c=>({card:c, score:scoreDigimonForDeck(c, specialtyDepth)}))
    .sort((a,b)=>b.score-a.score);
  const optionCards = owned.filter(c=>c.type==='option')
    .map(c=>({card:c, score:scoreOptionForDeck(c)}))
    .sort((a,b)=>b.score-a.score);

  const deck = {};
  let total = 0;
  function addUpTo(card, maxCopies){
    const already = deck[card.id]||0;
    const owned_ = collection[card.id]||0;
    const canAdd = Math.min(owned_-already, maxCopies-already, MAX_DECK_COPIES-already, targetSize-total);
    if(canAdd>0){ deck[card.id] = already+canAdd; total += canAdd; }
  }

  partnerCards.forEach(c=> addUpTo(c, collection[c.id]||0));

  const digimonTarget = Math.round(targetSize * 23/30);
  digimonCards.forEach(({card})=>{ if(total<digimonTarget) addUpTo(card, collection[card.id]||0); });

  const optionTarget = targetSize - Math.round(targetSize*23/30) + (digimonTarget - Math.min(total, digimonTarget));
  optionCards.forEach(({card})=>{ if(total<targetSize) addUpTo(card, collection[card.id]||0); });

  // Backfill with anything remaining if collection was too thin to hit target size.
  digimonCards.concat(optionCards).forEach(({card})=>{ if(total<targetSize) addUpTo(card, collection[card.id]||0); });

  return deck;
}

function deckTotalCount(deckCards){ return Object.values(deckCards||{}).reduce((s,n)=>s+n, 0); }
function deckSpecialtyBreakdown(deckCards){
  const counts = {};
  Object.entries(deckCards||{}).forEach(([id,n])=>{
    const card = ALL_CARDS.find(c=>String(c.id)===String(id));
    if(!card) return;
    const key = card.type==='option' ? 'Option' : card.sp;
    counts[key] = (counts[key]||0) + n;
  });
  return counts;
}

function digivolveOptions(myCard, myDp, hand){
  const order = {R:0,C:1,U:2,A:0};
  return hand.filter(c=>{
    if(c.type!=='digimon') return false;
    if(c.sp !== myCard.sp) return false;
    if(c.lvl==='A') return true;
    return (order[c.lvl] === order[myCard.lvl]+1) && (myDp>=c.dp);
  });
}

// Speed Digivolve: same specialty/level-step requirement as a normal digivolve,
// but ignores the DP cost entirely.
function speedDigivolveOptions(myCard, hand){
  const order = {R:0,C:1,U:2,A:0};
  return hand.filter(c=>{
    if(c.type!=='digimon') return false;
    if(c.sp !== myCard.sp) return false;
    if(c.lvl==='A') return true;
    return order[c.lvl] === order[myCard.lvl]+1;
  });
}
function hasSpeedDigivolveCard(hand){
  return hand.some(c=> /disregard DP when digivolving/i.test(effectText(c)) || /^Speed-?\s*digivolve$/i.test((c.name||'').trim()));
}
function findSpeedDigivolveCard(hand){
  return hand.find(c=> /disregard DP when digivolving/i.test(effectText(c)) || /^Speed-?\s*digivolve$/i.test((c.name||'').trim()));
}

const B = {
  myScore:0, oppScore:0, round:1,
  turnPlayer:'me',
  myActive:null, oppActive:null,
  myHp:0, oppHp:0,
  myDpTotal:0, oppDpTotal:0,
  myHand:[],
  oppHand:[],
  phase:'deckselect',
  atkStep:'pick',
  myLockedAtk:null,
  mySupportChoiceId:'',
  oppSupportRevealed:null,
  selectedDeckId:null, // null | 0 | 1 | 2 -- which of your 3 decks you're using this match
  deckUsedThisMatch:{}, // {cardId: count} -- cards drawn from deck into hand so far this match
  log:[],
  events:[], // the same story as data -- see logData()
  matchWinner:null,
};

// ======================= STRUCTURED LOG + EXPORT =======================
// B.log is the readable text log. B.events is the same story as data: every input, every solver
// recommendation next to what you actually did, and the full state at that moment, so one exported
// file is enough to replay or debug a match. Cards are {id, name}, so exact stats come from cards.json.
const LOG_VERSION = 1;
function cardBrief(c){
  if(!c) return null;
  if(c.type==='option') return {id:c.id, name:c.name, type:'option', effect:c.effect};
  return {id:c.id, name:c.name, lvl:c.lvl, sp:c.sp, hp:c.hp, o:c.o, t:c.t, x:c.x, xt:c.xt, note:c.note, dp:c.dp, pp:c.pp, entryPenalty:c._entryPenalty||null};
}
function handBrief(h){ return (h||[]).map(c=>({id:c.id, name:c.name})); }
function tagsBrief(tags){
  return (tags||[]).map(t=>{
    const o = {type:t.type};
    ['attack','amount','value','mult','spec'].forEach(k=>{ if(t[k]!=null) o[k] = t[k]; });
    if(t.condition) o.if = t.condition.kind || t.condition;
    return o;
  });
}
function gridBrief(grid){
  const out = {};
  ['o','t','x'].forEach(a=>{ out[a] = {}; ['o','t','x'].forEach(b=>{ const c = grid[a][b]; out[a][b] = {dealt:c.myDmg, took:c.oppDmg, koOpp:c.koOpp, koMe:c.koMe}; }); });
  return out;
}
function deckLeftMap(){
  const list = getRemainingDeckList();
  if(!list.length) return null;
  const m = {};
  list.forEach(r=>{ m[r.card.name] = (m[r.card.name]||0) + r.count; });
  return m;
}
function stateSnapshot(){
  const deck = getSelectedDeck();
  return {
    round:B.round, phase:B.phase, step:B.phase==='dp' ? B.dpStep : (B.phase==='attack' ? B.atkStep : null), turnPlayer:B.turnPlayer,
    score:{me:B.myScore, opp:B.oppScore},
    me:{active:cardBrief(B.myActive), hp:B.myHp, dp:B.myDpTotal, hand:handBrief(B.myHand)},
    opp:{active:cardBrief(B.oppActive), hp:B.oppHp, dp:B.oppDpTotal, hand:handBrief(B.oppHand)},
    deck: deck ? {name:deck.name, left:deckLeftMap()} : null
  };
}
function logData(type, data){
  B.events.push({n:B.events.length+1, t:new Date().toISOString(), type, data:data||{}, state:stateSnapshot()});
}
function buildLogExport(){
  const deck = getSelectedDeck();
  return {
    app:'ddcb-battle-solver', logVersion:LOG_VERSION, exportedAt:new Date().toISOString(),
    solverSettings:{ KO_STAKES, OPP_ATTACK_WEIGHTS, PATH_SWING, PATH_RELIABILITY, SAC },
    match:{ round:B.round, score:{me:B.myScore, opp:B.oppScore}, deck: deck ? {name:deck.name, cards:deck.cards} : null },
    now:stateSnapshot(),
    events:B.events,
    readableLog:B.log.slice().reverse().map(e=>`R${e.round} ${e.text}`)
  };
}
function logEvent(text){
  B.log.unshift({round:B.round, text});
  B.events.push({n:B.events.length+1, t:new Date().toISOString(), type:'text', data:{round:B.round, text}});
  renderLog();
}

function newDuel(){
  Object.assign(B, {
    myScore:0, oppScore:0, round:1, turnPlayer:'me',
    myActive:null, oppActive:null, myHp:0, oppHp:0,
    myDpTotal:0, oppDpTotal:0, myHand:[], oppHand:[], phase:'deckselect',
    atkStep:'pick', myLockedAtk:null, mySupportChoiceId:'', oppSupportRevealed:null,
    selectedDeckId:null, deckUsedThisMatch:{},
    log:[], events:[], matchWinner:null
  });
  logData('duel.new');
  renderAll();
}

function getSelectedDeck(){
  return (B.selectedDeckId!=null && DECKS[B.selectedDeckId]) ? DECKS[B.selectedDeckId] : null;
}
function deckRemaining(cardId){
  const deck = getSelectedDeck();
  if(!deck) return null; // no deck tracking active
  const total = deck.cards[cardId]||0;
  const used = B.deckUsedThisMatch[cardId]||0;
  return Math.max(0, total-used);
}
function getRemainingDeckList(){
  const deck = getSelectedDeck();
  if(!deck) return [];
  return Object.keys(deck.cards).map(id=>{
    const card = ALL_CARDS.find(c=>String(c.id)===String(id));
    const remaining = deckRemaining(id);
    return card && remaining>0 ? {card, count:remaining} : null;
  }).filter(Boolean);
}
function anyDeckConfigured(){ return DECKS.some(d=>d && deckTotalCount(d.cards)>0); }

let handUidCounter = 0;
function withUid(card){ return Object.assign({}, card, { _uid: card.id + '_h' + (++handUidCounter) }); }
function findInHand(hand, idOrUid){
  return hand.find(c=>String(c._uid)===String(idOrUid)) || hand.find(c=>String(c.id)===String(idOrUid)) || null;
}
function removeFromHand(idOrUid){
  const i = B.myHand.findIndex(c=>String(c._uid)===String(idOrUid));
  if(i>=0){ B.myHand.splice(i,1); return; }
  const j = B.myHand.findIndex(c=>String(c.id)===String(idOrUid));
  if(j>=0) B.myHand.splice(j,1);
}
function removeFromOppHand(idOrUid){
  const i = B.oppHand.findIndex(c=>String(c._uid)===String(idOrUid));
  if(i>=0){ B.oppHand.splice(i,1); return; }
  const j = B.oppHand.findIndex(c=>String(c.id)===String(idOrUid));
  if(j>=0) B.oppHand.splice(j,1);
}
function activeFor(player){ return player==='me' ? B.myActive : B.oppActive; }

function beginTurnPhaseFor(player){
  B.turnPlayer = player;
  B.phase = 'draw';
}

function endTurnAndAdvance(){
  const next = B.turnPlayer==='me' ? 'opp' : 'me';
  beginTurnPhaseFor(next);
  logData('turn.advance', {next});
  renderAll();
}

function hpBar(cur, max){
  const pct = max>0 ? Math.max(0,Math.min(100, Math.round(cur/max*100))) : 0;
  return `<div class="hp-bar"><div class="hp-bar-fill" style="width:${pct}%"></div></div>`;
}
function partnerBadge(card){
  return card && card.isPartner ? '<span class="badge" style="background:#008000;border-color:#000" title="Partner Digimon: can gain EXP, equip Digi-Parts, Armor Digivolve with a Digi-Egg">PARTNER</span>' : '';
}
function cardMiniPreview(card, hp){
  if(!card) return `<div class="small-note">Not chosen yet.</div>`;
  return `
    <div class="card-preview">
      <div class="name">${card.name} <span class="badge ${specClass(card.sp)}">${card.sp}</span> <span class="badge" style="background:#000080;border-color:#000">${card.lvl}</span> ${partnerBadge(card)}</div>
      <div>HP ${hp} / ${card.hp}</div>
      ${hpBar(hp, card.hp)}
      <div class="atk-grid">
        <div class="atk-box"><div class="lbl">CIRCLE</div><div class="val">${card.o}</div></div>
        <div class="atk-box"><div class="lbl">TRIANGLE</div><div class="val">${card.t}</div></div>
        <div class="atk-box"><div class="lbl">CROSS</div><div class="val">${card.x}</div></div>
      </div>
      <div class="xnote">X-effect: ${card.xt}</div>
    </div>`;
}

function renderHeader(){
  const el = document.getElementById('battleHeader');
  el.innerHTML = `
    <div class="flex-between">
      <div class="scoreboard">
        <div class="score-badge">YOU <b>${B.myScore}</b></div>
        <div class="score-badge">OPPONENT <b>${B.oppScore}</b></div>
        <div class="score-badge">ROUND <b>${B.round}</b></div>
        <div class="score-badge">TURN <b>${B.turnPlayer==='me'?'YOURS':"OPPONENT'S"}</b></div>
        <div class="score-badge">MY DP <b>${B.myDpTotal}</b></div>
        <div class="score-badge">OPP DP <b>${B.oppDpTotal}</b></div>
      </div>
      <button class="btn secondary small" onclick="App.newDuel()">RESET DUEL</button>
    </div>
    <div class="steps">
      ${['draw','entrance','dp','attack'].map(s=>{
        const cls = s===B.phase ? 'current' : '';
        return `<div class="step ${cls}">${s.toUpperCase()}</div>`;
      }).join('')}
    </div>
  `;
}

function renderStatePanel(){
  const el = document.getElementById('statePanel');
  const deck = getSelectedDeck();
  const remainingList = deck ? getRemainingDeckList() : [];
  const remainingTotal = remainingList.reduce((s,r)=>s+r.count,0);
  el.innerHTML = `
    <div class="row">
      <div class="col"><label>YOUR ACTIVE</label>${cardMiniPreview(B.myActive, B.myHp)}</div>
      <div class="col"><label>OPPONENT'S ACTIVE</label>${cardMiniPreview(B.oppActive, B.oppHp)}</div>
    </div>
    <div class="row">
      <div class="col">
        <label>YOUR HAND (add cards as you draw them — duplicates are fine, e.g. two Agumon)</label>
        ${deck ? `<div class="small-note">Using <b>${deck.name}</b> — ${remainingTotal} of ${deckTotalCount(deck.cards)} cards not yet drawn.
          <label style="display:inline;margin:0 0 0 10px"><input type="checkbox" id="handIgnoreDeckFilter" style="width:auto;vertical-align:middle"> search all cards, not just this deck</label></div>` : ''}
        <div class="search-box">
          <input id="handSearch" placeholder="Type a card name..." autocomplete="off">
          <div class="suggest-list" id="handSearch_list"></div>
        </div>
        <div class="hand-chips" id="handChips">
          ${B.myHand.map(c=>`<span class="chip selected" data-remove="${c._uid}">${c.name}${c.type==='option'?' <span class="small-note">(opt)</span>':''} ✕</span>`).join('')}
        </div>
      </div>
      <div class="col">
        <label>OPPONENT'S HAND (visible — keep this in sync as they draw/play)</label>
        <div class="search-box">
          <input id="oppHandSearch" placeholder="Type a card name..." autocomplete="off">
          <div class="suggest-list" id="oppHandSearch_list"></div>
        </div>
        <div class="hand-chips" id="oppHandChips">
          ${B.oppHand.map(c=>`<span class="chip selected" data-oppremove="${c._uid}">${c.name}${c.type==='option'?' <span class="small-note">(opt)</span>':''} ✕</span>`).join('')}
        </div>
      </div>
    </div>
  `;
  const ignoreFilterBox = document.getElementById('handIgnoreDeckFilter');
  wireSearchBox('handSearch', { onlyInDeck: !!(deck && ignoreFilterBox && !ignoreFilterBox.checked) }, (card)=>{
    if(B.myHand.length>=4){ alert('Hand is already at 4 cards.'); return; }
    B.myHand.push(withUid(card));
    if(deck){ B.deckUsedThisMatch[card.id] = (B.deckUsedThisMatch[card.id]||0) + 1; }
    logData('hand.add', {who:'me', card:{id:card.id, name:card.name}});
    logEvent(`You added ${card.name} to your hand (now: ${B.myHand.map(c=>c.name).join(', ')}).`);
    renderStatePanel();
    renderPhase();
  });
  if(ignoreFilterBox) ignoreFilterBox.addEventListener('change', renderStatePanel);
  wireSearchBox('oppHandSearch', {}, (card)=>{
    if(B.oppHand.length>=4){ alert("Opponent's hand is already at 4 cards."); return; }
    B.oppHand.push(withUid(card));
    logData('hand.add', {who:'opp', card:{id:card.id, name:card.name}});
    logEvent(`Opponent's hand: ${B.oppHand.map(c=>c.name).join(', ')}.`);
    renderStatePanel();
    renderPhase();
  });
  document.querySelectorAll('#handChips [data-remove]').forEach(chip=>{
    chip.addEventListener('click', ()=>{ const c = findInHand(B.myHand, chip.dataset.remove); removeFromHand(chip.dataset.remove); logData('hand.remove', {who:'me', card:c?{id:c.id, name:c.name}:null}); logEvent(`You removed ${c?c.name:'a card'} from your hand (now: ${B.myHand.map(x=>x.name).join(', ')||'empty'}).`); renderStatePanel(); renderPhase(); });
  });
  document.querySelectorAll('#oppHandChips [data-oppremove]').forEach(chip=>{
    chip.addEventListener('click', ()=>{ const c = findInHand(B.oppHand, chip.dataset.oppremove); removeFromOppHand(chip.dataset.oppremove); logData('hand.remove', {who:'opp', card:c?{id:c.id, name:c.name}:null}); logEvent(`Opponent's hand: ${B.oppHand.map(x=>x.name).join(', ')||'empty'}.`); renderStatePanel(); renderPhase(); });
  });
}

function wireSearchBox(inputId, opts, onSelect){
  const input = document.getElementById(inputId);
  const list = document.getElementById(inputId+'_list');
  if(!input || !list) return;
  input.addEventListener('input', ()=>{
    const results = searchCards(input.value, opts);
    if(!input.value.trim()){ list.classList.remove('open'); list.innerHTML=''; return; }
    list.innerHTML = results.map(c=>{
      const rem = getSelectedDeck() ? deckRemaining(c.id) : null;
      const typeLabel = c.type==='option' ? 'OPTION CARD' : (c.sp+' · '+c.lvl);
      return `<div class="suggest-item" data-id="${c.id}"><span class="tname">${c.name}</span><span class="ttype">${typeLabel}${rem!=null?' · '+rem+' left in deck':''}</span></div>`;
    }).join('') || '<div class="suggest-item">No matches</div>';
    list.classList.add('open');
    list.querySelectorAll('.suggest-item[data-id]').forEach(item=>{
      item.addEventListener('click', ()=>{
        const id = item.dataset.id;
        const card = ALL_CARDS.find(c=>String(c.id)===String(id));
        if(card) onSelect(card);
        input.value=''; list.classList.remove('open'); list.innerHTML='';
      });
    });
  });
  input.addEventListener('blur', ()=> setTimeout(()=>list.classList.remove('open'), 200));
}

function renderPhase(){
  const el = document.getElementById('phasePanel');
  if(B.phase==='deckselect') return renderDeckSelectPhase(el);
  if(B.phase==='kickoff') return renderKickoffPhase(el);
  if(B.phase==='draw') return renderDrawPhase(el);
  if(B.phase==='entrance') return renderEntrancePhase(el);
  if(B.phase==='dp') return renderDpPhase(el);
  if(B.phase==='attack') return renderAttackPhase(el);
  if(B.phase==='over') return renderMatchOverPhase(el);
}

function renderMatchOverPhase(el){
  const won = B.matchWinner==='me';
  el.innerHTML = `
    <h2>▸ MATCH OVER — ${won ? 'YOU WIN' : 'YOU LOSE'} ${B.myScore}–${B.oppScore}</h2>
    <div class="reason">${won ? 'Three KOs — the match is yours.' : 'The opponent reached three KOs.'} Export the log if you want it analysed, then start a new duel.</div>
    <button class="btn" style="margin-top:12px" onclick="App.newDuel()">NEW DUEL</button>
    <button class="btn secondary" style="margin-top:12px" onclick="App.exportLog()">EXPORT LOG (JSON)</button>
  `;
}

// The search box clears itself after a pick, so say what was picked in plain text instead of
// leaving an empty-looking field.
function revealStatus(card){
  return card ? `<span style="color:var(--nature)">✔ Applied: <b>${card.name}</b></span> — its effect is used when you resolve.` : 'Nothing entered yet — it will be treated as an unknown card with no effect.';
}

function renderDrawPhase(el){
  const isMe = B.turnPlayer==='me';
  el.innerHTML = `
    <h2>▸ PREP PHASE: DRAW (${isMe?'YOUR':"OPPONENT'S"} TURN)</h2>
    ${isMe ? `
      <div class="small-note">Draw back up to 4 cards and add them in the "Your Hand" box above. You can redraw your whole hand instead if you'd rather — just clear and re-add. Take your time; recommendations below won't appear until you move on.</div>
      <div class="small-note" style="margin-top:6px">Current hand size: <b>${B.myHand.length}</b> / 4</div>
    ` : `
      <div class="small-note">Opponent draws back up to 4 cards (their hand isn't tracked here — you'll enter what they reveal as we go).</div>
    `}
    <button class="btn" style="margin-top:14px" onclick="App.confirmDraw()">CONTINUE →</button>
  `;
}

function renderDeckSelectPhase(el){
  if(!anyDeckConfigured()){
    el.innerHTML = `
      <h2>▸ WHICH DECK?</h2>
      <div class="small-note">No decks are set up yet (see the Deck Builder tab), so hand suggestions won't be filtered or scored against deck contents this match. You can still play normally.</div>
      <button class="btn" style="margin-top:10px" onclick="App.skipDeckSelection()">CONTINUE →</button>
    `;
    return;
  }
  el.innerHTML = `
    <h2>▸ WHICH DECK ARE YOU USING?</h2>
    <div class="small-note">Selecting a deck lets the tool filter hand suggestions to cards actually in it, and score "play a random card" using what's really left in your deck.</div>
    ${[0,1,2].map(i=>{
      const d = DECKS[i];
      if(!d || deckTotalCount(d.cards)===0) return '';
      return `<div class="suggestion-rank">
        <span><b>${d.name}</b> — ${deckTotalCount(d.cards)} cards</span>
        <button class="btn small" onclick="App.selectDeckForMatch(${i})">USE THIS DECK</button>
      </div>`;
    }).join('')}
    <button class="btn secondary small" style="margin-top:10px" onclick="App.skipDeckSelection()">DON'T TRACK A DECK THIS MATCH</button>
  `;
}

function renderKickoffPhase(el){
  el.innerHTML = `
    <h2>▸ WHO GOES FIRST?</h2>
    <div class="small-note">Turn order is random in the real game (pick a face-down card). Tell the tool who won it.</div>
    <div class="row" style="margin-top:10px">
      <button class="btn" onclick="App.setKickoff('me')">I GO FIRST</button>
      <button class="btn secondary" onclick="App.setKickoff('opp')">OPPONENT GOES FIRST</button>
    </div>
  `;
}

function applyEntranceSelection(card){
  const adjusted = adjustForEntrance(card);
  document.getElementById('entranceInput').value = card.name;
  document.getElementById('entrancePreview').innerHTML = cardMiniPreview(adjusted, adjusted.hp) +
    (adjusted._entryPenalty ? '<div class="warn-box">Entered directly as '+card.lvl+' — HP and all attacks reduced to '+(adjusted._entryPenalty==='quarter'?'1/4 (Ultimate penalty)':'1/2 (Champion penalty)')+' of base.</div>' : '');
  document.getElementById('entranceConfirmBtn').disabled = false;
  App._entrancePicked = { raw: card, adjusted };
}

function renderEntrancePhase(el){
  const isMe = B.turnPlayer==='me';
  const oppKnown = isMe ? B.oppActive : null;
  const ranked = isMe ? rankEntranceCandidates(B.myHand, oppKnown, B.oppHp, B.myDpTotal) : [];
  if(isMe) App._lastEntrance = ranked.map(r=>({uid:r.card._uid||r.card.id, id:r.card.id, name:r.card.name, heuristic:r.heuristic, score:r.matchupVal, key:r.matchupKey==null?null:Math.round(r.matchupKey), swing:r.matchupSwing, koMe:r.matchupKoMe, koOpp:r.matchupKoOpp, route:r.path}));

  el.innerHTML = `
    <h2>▸ PREP PHASE: ENTRANCE (${isMe?'YOUR':"OPPONENT'S"} TURN)</h2>
    <div class="small-note">Entering directly with a Champion or Ultimate (instead of digivolving up later) halves its HP and all three attacks.</div>
    ${isMe ? `
      <label>RECOMMENDED PICKS FROM YOUR HAND ${oppKnown ? '(real matchup vs '+oppKnown.name+')' : '(no opponent active known yet — heuristic ranking on HP/damage/effect quality)'}</label>
      ${ranked.length ? ranked.map((r,i)=>`
        <div class="suggestion-rank ${i===0?'top':''}">
          <span>
            <b>${r.card.name}</b>${r.card._entryPenalty?' ('+(r.card._entryPenalty==='quarter'?'1/4':'1/2')+' on entry)':''} — HP ${r.card.hp}, avg attack ${r.avgAtk}
            ${r.notes.length ? '<br><span class="small-note">'+r.notes.join(' ')+'</span>' : ''}
          </span>
          <span class="val">${r.matchupVal!==null ? fmtOutcome(r.matchupSwing, r.matchupKoMe, r.matchupKoOpp)+' worst-case' : 'score '+r.heuristic}</span>
          <button class="btn small secondary" onclick="App.pickEntrance('${r.card._uid||r.card.id}')">USE THIS</button>
        </div>`).join('') : '<div class="small-note">No Digimon cards in hand to enter with.</div>'}
    ` : ''}
    <label style="margin-top:14px">${isMe? 'OR SEARCH MANUALLY':"OPPONENT'S ACTIVE PICK"}</label>
    <div class="search-box"><input id="entranceInput" placeholder="Type a Digimon name..." autocomplete="off"><div class="suggest-list" id="entranceInput_list"></div></div>
    <div id="entrancePreview"></div>
    <button class="btn" style="margin-top:14px" id="entranceConfirmBtn" disabled onclick="App.confirmEntrance()">CONFIRM →</button>
  `;
  wireSearchBox('entranceInput', {type:'digimon'}, (card)=> applyEntranceSelection(card));
}

// DP banked now isn't wasted just because nothing in hand can spend it THIS
// turn -- it still moves you toward whatever you draw next. Weighted toward a
// typical Champion-tier cost (based on observed data), tapering off once
// you're already past that threshold since the marginal value of extra
// banked DP drops once you can already afford most things.
function bankingBonus(currentDp, ppGained){
  if(ppGained<=0) return 0;
  const benchmark = 30;
  if(currentDp >= benchmark) return Math.round(ppGained*0.3);
  const remaining = benchmark - currentDp;
  const effective = Math.min(ppGained, remaining);
  const overflow = Math.max(0, ppGained-remaining);
  return Math.round(effective*1.2 + overflow*0.3);
}

// Digivolving resets your active to the new form's full HP -- so when your
// current active is already low, banked DP isn't just progress toward a
// bigger body someday, it's a live escape hatch from a likely KO next hit.
// Scale the banking bonus up sharply as HP gets dangerous.
function urgencyMultiplier(myHp, myMaxHp){
  if(!myMaxHp || myHp==null) return 1;
  const pct = myHp/myMaxHp;
  if(pct<=0.15) return 3.0;
  if(pct<=0.3) return 2.2;
  if(pct<=0.5) return 1.5;
  return 1.0;
}

function rankSacrificeOptions(myActive, myDpTotal, hand, myHp){
  const digimonCandidates = hand.filter(c=>c.type==='digimon');
  const results = [];
  const baselineEvo = myActive ? digivolveOptions(myActive, myDpTotal, hand) : [];
  const urgency = myActive ? urgencyMultiplier(myHp, myActive.hp) : 1;
  // An Ultimate has nowhere left to digivolve, so banked DP is dead weight for it.
  const canUseDp = !!myActive && myActive.lvl!=='U';
  const pathNow = digivolvePath(myActive, hand, myDpTotal);
  const baseline = replacementBaseline();
  // Standing still has a real cost when you're endangered AND have no path to
  // digivolve right now -- staying a fragile low-tier form while low on HP is
  // itself a risk, not a neutral default.
  const standStillPenalty = (canUseDp && !baselineEvo.length && urgency>1) ? Math.round(-20*urgency) : 0;
  results.push({
    id:'', name:'— sacrifice nothing —',
    note: baselineEvo.length ? `You already have ${baselineEvo.length} eligible digivolve target(s) at your current ${myDpTotal} DP.` :
      (standStillPenalty ? `No eligible digivolve targets, and your HP is low enough that staying put carries real risk (${standStillPenalty} for doing nothing).` : `No eligible digivolve targets yet at your current ${myDpTotal} DP.`),
    score: standStillPenalty
  });

  digimonCandidates.forEach(card=>{
    const uid = String(card._uid||card.id);
    const remainingHand = hand.filter(c=>String(c._uid||c.id)!==uid);
    const newDp = myDpTotal + (card.pp||0);
    const beforeEvo = myActive ? digivolveOptions(myActive, myDpTotal, remainingHand) : [];
    const afterEvo = myActive ? digivolveOptions(myActive, newDp, remainingHand) : [];
    const newlyUnlocked = afterEvo.filter(e=>!beforeEvo.some(b=>String(b.id)===String(e.id)));
    const eff = effectQualityNote(card);
    const value = cardValue(card);
    const cost = Math.round(Math.max(0, value - baseline) * SAC.costWeight);
    const pathAfter = digivolvePath(myActive, remainingHand, newDp);
    const pathDelta = pathAfter.value - pathNow.value; // up when the DP closes the gap, down when this card IS the route up
    let score = -cost + pathDelta;
    let note = `+${card.pp||0} DP (would bring your total to ${newDp}).`;
    if(!canUseDp){
      score -= 5;
      note += ' Your active is already Ultimate, so banked DP has nowhere to go.';
    } else if(newlyUnlocked.length){
      score += 200;
      note += ` Unlocks digivolving into ${newlyUnlocked.map(e=>e.name).join(', ')} THIS turn.`;
    } else {
      const bonus = Math.round(bankingBonus(myDpTotal, card.pp||0) * urgency);
      if(bonus>0){
        score += bonus;
        note += urgency>1
          ? ` No immediate target, but your HP is low enough that banked DP is a real escape hatch — digivolving refreshes to full HP (+${bonus} urgent banking value, ${urgency}x).`
          : ` No immediate target, but banks progress toward a future digivolve (+${bonus} banking value).`;
      }
    }
    if(pathNow.target && String(pathNow.target._uid||pathNow.target.id)===uid) note += ` This is your route up (${card.name}) — sacrificing it gives that up.`;
    note += ` Replacing it with a typical draw costs about ${cost} (this card ~${value} vs ~${baseline}).`;
    if(eff.notes.length) note += ' Giving up: ' + eff.notes.join(' ');
    results.push({ id:uid, name:card.name, note, score });
  });
  return results.sort((a,b)=>b.score-a.score);
}

function renderDpPhase(el){
  const isMe = B.turnPlayer==='me';
  const active = activeFor(B.turnPlayer);
  const dpTotal = isMe ? B.myDpTotal : B.oppDpTotal;

  if(!isMe){
    const oppEvoPreview = active ? digivolveOptions(active, dpTotal, B.oppHand) : [];
    el.innerHTML = `
      <h2>▸ DP PHASE (OPPONENT'S TURN)</h2>
      <div class="small-note">Sacrificing for DP and digivolving in the same turn are both allowed together.</div>
      <label>DID THE OPPONENT SACRIFICE A CARD? (pick from their tracked hand)</label>
      <select id="oppSacSelect">
        <option value="">— none —</option>
        ${B.oppHand.filter(c=>c.type==='digimon').map(c=>`<option value="${c._uid}">${c.name} (+${c.pp||0} DP)</option>`).join('')}
      </select>
      <button class="btn small" style="margin-top:8px" onclick="App.doOppSacrifice()">CONFIRM SACRIFICE</button>
      <div class="small-note" style="margin-top:6px">If their hand isn't fully tracked yet, you can enter it manually instead:</div>
      <div class="search-box"><input id="oppSacInput" placeholder="Card name" autocomplete="off"><div class="suggest-list" id="oppSacInput_list"></div></div>
      <input type="number" id="oppSacAmount" placeholder="DP gained, if typing a name not in their tracked hand">
      ${oppEvoPreview.length ? `
        <h2 style="margin-top:16px">▸ WHAT THEY COULD DIGIVOLVE INTO (${dpTotal} DP banked)</h2>
        ${oppEvoPreview.map(c=>`
          <div class="suggestion-rank">
            <span><b>${c.name}</b> (${c.lvl}, needs ${c.dp} DP) — HP ${c.hp}, O ${c.o}/T ${c.t}/X ${c.x}</span>
            <button class="btn small secondary" onclick="App.doOppDigivolve('${c._uid}')">THEY DID THIS</button>
          </div>
        `).join('')}
      ` : `<h2 style="margin-top:16px">▸ DID OPPONENT DIGIVOLVE?</h2><div class="small-note">Nothing in their tracked hand is eligible at ${dpTotal} DP.</div>`}
      <label style="margin-top:10px">OR ENTER MANUALLY</label>
      <div class="search-box"><input id="oppEvoInput" placeholder="New form, if any" autocomplete="off"><div class="suggest-list" id="oppEvoInput_list"></div></div>
      <button class="btn" style="margin-top:16px" onclick="App.confirmDpDone()">CONTINUE →</button>
    `;
    wireSearchBox('oppSacInput', {}, (card)=>{
      document.getElementById('oppSacInput').value = card.name;
      document.getElementById('oppSacAmount').value = card.pp||0;
    });
    wireSearchBox('oppEvoInput', {type:'digimon'}, (card)=>{
      B.oppActive = Object.assign({}, card); B.oppHp = card.hp;
      removeFromOppHand(card.id);
      B.oppDpTotal = 0;
      document.getElementById('oppEvoInput').value = card.name;
      logEvent(`Opponent digivolved to ${card.name} (DP counter spent, reset to 0).`);
      logData('dp.digivolve', {who:'opp', via:'dp', to:cardBrief(card)});
    });
    return;
  }

  if(!B.dpStep) B.dpStep = 'sacrifice';
  if(B.dpStep==='digivolve' && !digivolveOptions(active, dpTotal, B.myHand).length) B.dpStep = 'speedDigivolve';
  if(B.dpStep==='speedDigivolve'){
    const sc = findSpeedDigivolveCard(B.myHand);
    const opts = sc ? speedDigivolveOptions(active, B.myHand.filter(c=>c._uid!==sc._uid)) : [];
    if(!sc || !opts.length) B.dpStep = 'done';
  }

  if(B.dpStep==='sacrifice') return renderDpSacrificeStep(el, active, dpTotal);
  if(B.dpStep==='digivolve') return renderDpDigivolveStep(el, active, dpTotal);
  if(B.dpStep==='speedDigivolve') return renderDpSpeedDigivolveStep(el, active, dpTotal);
  return renderDpDoneStep(el, active, dpTotal);
}

function renderDpSacrificeStep(el, active, dpTotal){
  const sacRanked = rankSacrificeOptions(active, dpTotal, B.myHand, B.myHp);
  App._lastSacrifice = sacRanked.map(r=>({id:r.id, name:r.name, score:r.score}));
  el.innerHTML = `
    <h2>▸ DP PHASE — STEP 1/3: SACRIFICE</h2>
    <div class="small-note">Pick a card to sacrifice, or skip. Either choice moves you straight to the next step.</div>
    <label>SACRIFICE ADVISOR (ranked by DP gained vs. what you'd give up)</label>
    ${sacRanked.map((r,i)=>`
      <div class="suggestion-rank ${i===0?'top':''}">
        <span>${r.name}<br><span class="small-note">${r.note}</span></span>
        <button class="btn small secondary" onclick="App.doSacrifice('${r.id}')">${r.id?'SACRIFICE':'SKIP'}</button>
      </div>`).join('')}
  `;
}

function renderDpDigivolveStep(el, active, dpTotal){
  const evoOptions = digivolveOptions(active, dpTotal, B.myHand);
  const adv = digivolveAdvice(active, B.myHp, B.oppActive, evoOptions.slice().sort((a,b)=>b.hp-a.hp)[0]);
  App._lastDigivolveAdvice = adv;
  el.innerHTML = `
    <h2>▸ DP PHASE — STEP 2/3: DIGIVOLVE (banked DP: ${dpTotal})</h2>
    <div class="small-note">You can afford these. Pick one, or skip.</div>
    ${adviceHtml(adv, 'hold (skip)')}
    ${evoOptions.map(c=>`
      <div class="suggestion-rank">
        <span><b>${c.name}</b> (${c.lvl}, needs ${c.dp} DP) — HP ${c.hp}, O ${c.o}/T ${c.t}/X ${c.x}</span>
        <button class="btn small" onclick="App.doDigivolve('${c._uid}')">DIGIVOLVE</button>
      </div>`).join('')}
    <button class="btn secondary small" style="margin-top:10px" onclick="App.skipDigivolveStep()">SKIP</button>
  `;
}

function renderDpSpeedDigivolveStep(el, active, dpTotal){
  const sc = findSpeedDigivolveCard(B.myHand);
  const opts = speedDigivolveOptions(active, B.myHand.filter(c=>c._uid!==sc._uid));
  const adv = digivolveAdvice(active, B.myHp, B.oppActive, opts.slice().sort((a,b)=>b.hp-a.hp)[0]);
  App._lastDigivolveAdvice = adv;
  el.innerHTML = `
    <h2>▸ DP PHASE — STEP 3/3: SPEED DIGIVOLVE (${sc.name} in hand — DP cost waived)</h2>
    <div class="small-note">Pick a target, or skip.</div>
    ${adviceHtml(adv, 'hold (skip) and keep '+sc.name+' for when you need the refill')}
    ${opts.map(c=>`
      <div class="suggestion-rank">
        <span><b>${c.name}</b> (${c.lvl}) — HP ${c.hp}, O ${c.o}/T ${c.t}/X ${c.x}</span>
        <button class="btn small" onclick="App.doSpeedDigivolve('${c._uid}')">SPEED DIGIVOLVE</button>
      </div>`).join('')}
    <button class="btn secondary small" style="margin-top:10px" onclick="App.skipSpeedDigivolveStep()">SKIP</button>
  `;
}

function renderDpDoneStep(el, active, dpTotal){
  el.innerHTML = `
    <h2>▸ DP PHASE COMPLETE</h2>
    <div class="small-note">Active: <b>${active.name}</b> — banked DP: <b>${dpTotal}</b></div>
    <button class="btn" style="margin-top:12px" onclick="App.confirmDpDone()">CONTINUE →</button>
  `;
}

function renderAttackPhase(el){
  if(!B.myActive || !B.oppActive){ el.innerHTML = '<div class="small-note">Missing active Digimon on one side — this phase should not be reachable yet.</div>'; return; }
  const iAmTurnPlayer = B.turnPlayer==='me';

  if(B.atkStep==='pick'){
    const grid = computeMatrix(B.myActive, B.oppActive, B.myHp, B.oppHp, [], 0, iAmTurnPlayer);
    const rec = maximin(grid);
    App._lastAttackRec = {best:rec.best, worst:rec.bestVal, mean:Math.round(rec.bestMean), swing:rec.bestSwing, koMe:rec.bestKoMe, koOpp:rec.bestKoOpp, grid:gridBrief(grid)};
    const labels = {o:'Circle',t:'Triangle',x:'Cross'};
    let matrixHtml = '<table class="matrix"><tr><th>You \u2193 / Foe \u2192</th><th>Circle</th><th>Triangle</th><th>Cross</th></tr>';
    ['o','t','x'].forEach(a=>{
      matrixHtml += `<tr><th>${labels[a]}</th>`;
      ['o','t','x'].forEach(b=>{
        const cell = grid[a][b];
        const cls = (a===rec.best?'best':'') + (cell.koOpp?' ko':'');
        matrixHtml += `<td class="${cls}">${cell.myDmg} dealt${cell.koOpp?' (KO!)':''}<br><span class="small-note">take ${cell.oppDmg}${cell.koMe?' (you would be KO\u2019d)':''}</span></td>`;
      });
      matrixHtml += '</tr>';
    });
    matrixHtml += '</table>';
    el.innerHTML = `
      <h2>▸ ATTACK PHASE — CHOOSE YOUR ATTACK (BLIND)</h2>
      <div class="small-note">${iAmTurnPlayer?'It is your turn — you attack first by default, unless the opponent\u2019s card steals it.':'It is the opponent\u2019s turn — they attack first by default, unless your card steals it.'}</div>
      <div class="rec">
        <div class="headline">Recommended: ${labels[rec.best]}</div>
        <div class="reason">Worst-case net HP swing assuming they play optimally: <b>${fmtOutcome(rec.bestSwing, rec.bestKoMe, rec.bestKoOpp)}</b>. KOs count extra, more the closer either side is to 3.</div>
      </div>
      ${matrixHtml}
      <label style="margin-top:14px">LOCK IN YOUR ATTACK</label>
      <select id="myAtkPick"><option value="o" ${rec.best==='o'?'selected':''}>Circle</option><option value="t" ${rec.best==='t'?'selected':''}>Triangle</option><option value="x" ${rec.best==='x'?'selected':''}>Cross</option></select>
      <button class="btn" style="margin-top:10px" onclick="App.lockMyAttack()">LOCK IT IN →</button>
    `;
    return;
  }

  if(B.atkStep==='awaitOppSupport'){
    el.innerHTML = `
      <h2>▸ SUPPORT PHASE — OPPONENT REVEALS FIRST</h2>
      <div class="small-note">It's your turn, so the opponent (non-turn player) commits their support first. Pick what they played from their tracked hand (or leave as none). This can be a tell for their attack.</div>
      <select id="oppSupportRevealSelect">
        <option value="">— none —</option>
        <option value="__random__">— unknown / random card from their deck —</option>
        ${B.oppHand.map(c=>`<option value="${c._uid}">${c.name}${c.type==='option'?' (option)':''}</option>`).join('')}
      </select>
      <div class="small-note" style="margin-top:8px">Not in their tracked hand? Enter manually:</div>
      <div class="search-box"><input id="oppSupportRevealInput" placeholder="Card name" autocomplete="off"><div class="suggest-list" id="oppSupportRevealInput_list"></div></div>
      <button class="btn" style="margin-top:14px" onclick="App.confirmOppSupportReveal()">CONTINUE →</button>
    `;
    wireSearchBox('oppSupportRevealInput', {}, (card)=>{
      document.getElementById('oppSupportRevealInput').value = card.name;
      App._pendingOppSupportCard = card;
      document.getElementById('oppSupportRevealSelect').value = '';
    });
    return;
  }

  if(B.atkStep==='myReactiveSupport'){
    const oppTags = B.oppSupportRevealed ? parseEffectTags(effectText(B.oppSupportRevealed), B.oppSupportRevealed) : [];
    const ranked = rankSupportOptions(B.myActive, B.oppActive, B.myHp, B.oppHp, B.myLockedAtk, B.myHand, oppTags, 0, iAmTurnPlayer);
    const redirectTag = oppTags.find(t=>t.type==='redirectOtherAttackValue');
    const redirectWarning = redirectTag ? `<div class="warn-box">${B.oppSupportRevealed.name} redirects your locked ${B.myLockedAtk.toUpperCase()} to use <b>${redirectTag.map[B.myLockedAtk].toUpperCase()}'s damage number</b> instead. Any support you pick that boosts/doubles "${B.myLockedAtk.toUpperCase()}" still applies — it checks which button you pressed, not which number came out — so it's scored against the redirected value below, not wasted.</div>` : '';
    const randomEv = getSelectedDeck() ? randomCardExpectedValue(B.myActive, B.oppActive, B.myHp, B.oppHp, B.myLockedAtk, oppTags, 0, iAmTurnPlayer) : null;
    const combined = ranked.map(r=>({id:r.id, name:r.name, val:r.worst, key:r.key, swing:r.swing, koMe:r.koMe, koOpp:r.koOpp, partial:r.partial, note:null}));
    if(randomEv){
      combined.push({id:'__random__', name:'Play a random card from my deck', val:randomEv.ev, key:randomEv.key, swing:randomEv.evSwing, note:`Expected value across the ${randomEv.poolSize} cards still unaccounted for in your tracked deck.${randomEv.koMeShare>0 ? ' In '+Math.round(randomEv.koMeShare*100)+'% of those draws the worst case gets you KO\u2019d.' : ''}`, approx:true});
    } else {
      combined.push({id:'__random__', name:'Play a random card from my deck', val:null, note:"Unknown effect — can't be scored (select a deck to get a real estimate here)."});
    }
    combined.sort((a,b)=>(b.key==null?-1e12:b.key)-(a.key==null?-1e12:a.key));
    App._lastSupport = combined.map(r=>({id:r.id, name:r.name, score:r.val, swing:r.swing, koMe:r.koMe, koOpp:r.koOpp, partial:r.partial}));
    el.innerHTML = `
      <h2>▸ YOUR SUPPORT (REACTING)</h2>
      <div class="small-note">You locked ${B.myLockedAtk.toUpperCase()}. Opponent's support: <b>${B.oppSupportRevealed?B.oppSupportRevealed.name:'none'}</b>. Ranked by worst-case outcome against their 3 possible attacks:</div>
      ${redirectWarning}
      ${combined.map((r,i)=>`
        <div class="suggestion-rank ${i===0?'top':''}">
          <span>${r.name}${partialMark(r.partial)}${r.note?'<br><span class="small-note">'+r.note+'</span>':''}</span>
          ${r.val!=null ? `<span class="val">${fmtOutcome(r.swing, r.koMe, r.koOpp, r.approx)}</span>` : ''}
          <button class="btn small secondary" onclick="App.pickMySupport('${r.id}')">USE</button>
        </div>`).join('')}
    `;
    return;
  }

  if(B.atkStep==='myBlindSupport'){
    const ranked = rankSupportOptionsOpenInfo(B.myActive, B.oppActive, B.myHp, B.oppHp, B.myLockedAtk, B.myHand, B.oppHand, iAmTurnPlayer);
    const oppPossibleSets = [[]].concat(B.oppHand.map(c=>parseEffectTags(effectText(c), c)));
    const randomEv = getSelectedDeck() ? randomCardExpectedValue(B.myActive, B.oppActive, B.myHp, B.oppHp, B.myLockedAtk, oppPossibleSets, 0, iAmTurnPlayer) : null;
    const combined = ranked.map(r=>({id:r.id, name:r.name, val:r.worst, key:r.key, swing:r.swing, koMe:r.koMe, koOpp:r.koOpp, partial:r.partial, note:null}));
    if(randomEv){
      combined.push({id:'__random__', name:'Play a random card from my deck', val:randomEv.ev, key:randomEv.key, swing:randomEv.evSwing, note:`Expected value across the ${randomEv.poolSize} cards still unaccounted for in your tracked deck.${randomEv.koMeShare>0 ? ' In '+Math.round(randomEv.koMeShare*100)+'% of those draws the worst case gets you KO\u2019d.' : ''}`, approx:true});
    } else {
      combined.push({id:'__random__', name:'Play a random card from my deck', val:null, note:"Unknown effect — can't be scored (select a deck to get a real estimate here)."});
    }
    combined.sort((a,b)=>(b.key==null?-1e12:b.key)-(a.key==null?-1e12:a.key));
    App._lastSupport = combined.map(r=>({id:r.id, name:r.name, score:r.val, swing:r.swing, koMe:r.koMe, koOpp:r.koOpp, partial:r.partial}));
    el.innerHTML = `
      <h2>▸ YOUR SUPPORT (COMMITTING BLIND)</h2>
      <div class="small-note">It's the opponent's turn, so you (non-turn player) must commit support first. You locked ${B.myLockedAtk.toUpperCase()}. Since their hand is visible, this is the true worst case across all 3 of their attacks and every support card actually in their hand (${B.oppHand.length} tracked) — not a guess.</div>
      <div id="rankedSupportList">
        ${combined.map((r,i)=>`
          <div class="suggestion-rank ${i===0?'top':''}">
            <span>${r.name}${partialMark(r.partial)}${r.note?'<br><span class="small-note">'+r.note+'</span>':''}</span>
            ${r.val!=null ? `<span class="val">${fmtOutcome(r.swing, r.koMe, r.koOpp, r.approx)}</span>` : ''}
            <button class="btn small secondary" onclick="App.pickMySupport('${r.id}')">USE</button>
          </div>`).join('')}
      </div>
      ${B.oppHand.length===0 ? '<div class="warn-box">Opponent\u2019s tracked hand is empty — if that\u2019s not actually true, add their cards in the panel above before trusting this ranking.</div>' : ''}
    `;
    return;
  }

  if(B.atkStep==='awaitOppSupportInfo'){
    el.innerHTML = `
      <h2>▸ OPPONENT REACTS</h2>
      <div class="small-note">You committed ${B.mySupportChoiceId==='__random__' ? 'a random card from your deck' : (B.mySupportChoiceId ? (findInHand(B.myHand, B.mySupportChoiceId)||{}).name : 'no support')}. The opponent (turn player) now sees that and picks their support. What did they play?</div>
      <select id="oppSupportRevealSelect2">
        <option value="">— none —</option>
        <option value="__random__">— unknown / random card from their deck —</option>
        ${B.oppHand.map(c=>`<option value="${c._uid}">${c.name}${c.type==='option'?' (option)':''}</option>`).join('')}
      </select>
      <div class="small-note" style="margin-top:8px">Not in their tracked hand? Enter manually:</div>
      <div class="search-box"><input id="oppSupportRevealInput2" placeholder="Card name" autocomplete="off"><div class="suggest-list" id="oppSupportRevealInput2_list"></div></div>
      <button class="btn" style="margin-top:14px" onclick="App.confirmOppSupportInfo()">CONTINUE →</button>
    `;
    wireSearchBox('oppSupportRevealInput2', {}, (card)=>{
      document.getElementById('oppSupportRevealInput2').value = card.name;
      App._pendingOppSupportCard = card;
      document.getElementById('oppSupportRevealSelect2').value = '';
    });
    return;
  }

  if(B.atkStep==='resolve'){
    const mySupportCard = (B.mySupportChoiceId && B.mySupportChoiceId!=='__random__') ? findInHand(B.myHand, B.mySupportChoiceId) : null;
    const myWasRandom = B.mySupportChoiceId==='__random__';
    const oppWasRandom = B.oppSupportRevealed && B.oppSupportRevealed.type==='unknown';
    el.innerHTML = `
      <h2>▸ RESOLVE — WHAT ACTUALLY HAPPENED</h2>
      <div class="small-note">You attacked <b>${B.myLockedAtk.toUpperCase()}</b>${mySupportCard?' with support '+mySupportCard.name:(myWasRandom?' with a random card':'')}. What did the opponent attack with?</div>
      <select id="oppAtkFinal">
        <option value="o">Circle</option><option value="t">Triangle</option><option value="x">Cross</option>
        <option value="__unknown__">Don't know — I KO'd them before they could act</option>
      </select>
      ${myWasRandom ? `
        <label style="margin-top:12px">YOUR RANDOM CARD WAS REVEALED AS (if you know now)</label>
        <div class="search-box"><input id="myRandomReveal" placeholder="Card name, if revealed" autocomplete="off"><div class="suggest-list" id="myRandomReveal_list"></div></div>
        <div class="small-note" id="myRandomRevealStatus" style="margin-top:4px">${revealStatus(App._myRandomRevealCard)}</div>
      ` : ''}
      ${oppWasRandom ? `
        <label style="margin-top:12px">OPPONENT'S RANDOM CARD WAS REVEALED AS (if you know now)</label>
        <div class="search-box"><input id="oppRandomReveal" placeholder="Card name, if revealed" autocomplete="off"><div class="suggest-list" id="oppRandomReveal_list"></div></div>
        <div class="small-note" id="oppRandomRevealStatus" style="margin-top:4px">${revealStatus(App._oppRandomRevealCard)}</div>
      ` : ''}
      <button class="btn" style="margin-top:14px" onclick="App.resolveTurn()">RESOLVE TURN</button>
    `;
    if(myWasRandom) wireSearchBox('myRandomReveal', {}, (card)=>{
      App._myRandomRevealCard = card;
      document.getElementById('myRandomRevealStatus').innerHTML = revealStatus(card);
      logData('random.revealed', {who:'me', card:{id:card.id, name:card.name}});
    });
    if(oppWasRandom) wireSearchBox('oppRandomReveal', {}, (card)=>{
      App._oppRandomRevealCard = card;
      document.getElementById('oppRandomRevealStatus').innerHTML = revealStatus(card);
      logData('random.revealed', {who:'opp', card:{id:card.id, name:card.name}});
    });
    return;
  }
}

function renderLog(){
  const el = document.getElementById('logList');
  const tools = `<div style="margin-bottom:6px"><button class="btn small secondary" onclick="App.exportLog()">EXPORT LOG (JSON)</button> <button class="btn small secondary" onclick="App.copyLog()">COPY JSON</button> <span class="small-note">${B.events.length} events recorded</span></div>`;
  el.innerHTML = tools + (B.log.map(e=>`<div class="log-entry"><span class="tag">R${e.round}</span>${e.text}</div>`).join('') || '<div class="small-note">No events yet.</div>');
}

function renderAll(){ renderHeader(); renderStatePanel(); renderPhase(); renderLog(); }

const App = {
  newDuel(){ if(confirm('Reset the whole duel (score, hand, DP totals)?')) newDuel(); },

  exportLog(){
    const text = JSON.stringify(buildLogExport(), null, 1);
    const stamp = new Date().toISOString().replace(/[:.]/g,'-').slice(0,19);
    const url = URL.createObjectURL(new Blob([text], {type:'application/json'}));
    const a = document.createElement('a');
    a.href = url; a.download = 'ddcb-battle-'+stamp+'.json';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=>URL.revokeObjectURL(url), 1000);
  },
  copyLog(){
    const text = JSON.stringify(buildLogExport(), null, 1);
    const fallback = ()=>{
      const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
      try{ document.execCommand('copy'); alert('Log copied.'); }catch(e){ alert('Copy failed — use EXPORT LOG (JSON) instead.'); }
      ta.remove();
    };
    if(navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(()=>alert('Log copied.'), fallback); else fallback();
  },

  confirmDraw(){
    logEvent(`Hands confirmed. You: ${B.myHand.map(c=>c.name).join(', ')||'empty'}. Opponent: ${B.oppHand.map(c=>c.name).join(', ')||'empty'}.`);
    logData('draw.confirmed');
    B.phase = activeFor(B.turnPlayer) ? 'dp' : 'entrance';
    if(B.phase==='dp') B.dpStep = 'sacrifice';
    renderAll();
  },

  selectDeckForMatch(i){
    B.selectedDeckId = i;
    B.deckUsedThisMatch = {};
    logEvent(`Using deck: ${DECKS[i].name} (${deckTotalCount(DECKS[i].cards)} cards).`);
    logData('deck.selected', {slot:i, name:DECKS[i].name, cards:Object.keys(DECKS[i].cards).map(id=>{ const c = ALL_CARDS.find(x=>String(x.id)===String(id)); return {id:c?c.id:id, name:c?c.name:String(id), count:DECKS[i].cards[id]}; })});
    B.phase = 'kickoff';
    renderAll();
  },

  skipDeckSelection(){
    B.selectedDeckId = null;
    logData('deck.none');
    B.phase = 'kickoff';
    renderAll();
  },

  setKickoff(who){
    beginTurnPhaseFor(who);
    logEvent(who==='me' ? 'You go first this match.' : 'Opponent goes first this match.');
    logData('kickoff', {first:who});
    renderAll();
  },

  pickEntrance(cardId){
    const card = findInHand(B.myHand, cardId);
    if(!card) return;
    applyEntranceSelection(card);
  },

  confirmEntrance(){
    const picked = App._entrancePicked;
    if(!picked){ alert('Pick a Digimon first.'); return; }
    if(B.turnPlayer==='me'){
      removeFromHand(picked.raw._uid||picked.raw.id);
      B.myActive = picked.adjusted; B.myHp = picked.adjusted.hp;
      logEvent(`You enter with ${picked.adjusted.name}${picked.adjusted._entryPenalty?' ('+(picked.adjusted._entryPenalty==='quarter'?'1/4':'1/2')+' stats on entry)':''}.`);
    } else {
      removeFromOppHand(picked.raw._uid||picked.raw.id);
      B.oppActive = picked.adjusted; B.oppHp = picked.adjusted.hp;
      logEvent(`Opponent enters with ${picked.adjusted.name}.`);
    }
    logData('entrance', {who:B.turnPlayer, picked:cardBrief(picked.adjusted), recommended:(B.turnPlayer==='me'?App._lastEntrance:null), followed:(B.turnPlayer==='me' && App._lastEntrance && App._lastEntrance.length) ? String(App._lastEntrance[0].uid)===String(picked.raw._uid||picked.raw.id) : null});
    App._entrancePicked = null;
    B.phase = 'dp';
    B.dpStep = 'sacrifice';
    renderAll();
  },

  doSacrifice(id){
    const adv = App._lastSacrifice || null;
    if(!id){ logEvent('You chose not to sacrifice this turn.'); logData('dp.sacrifice', {who:'me', card:null, advisor:adv, followed:adv&&adv.length ? adv[0].id==='' : null}); B.dpStep = 'digivolve'; renderAll(); return; }
    const card = findInHand(B.myHand, id);
    if(!card) return;
    B.myDpTotal += (card.pp||0);
    removeFromHand(card._uid||card.id);
    logEvent(`You sacrificed ${card.name} for +${card.pp||0} DP (total ${B.myDpTotal}).`);
    logData('dp.sacrifice', {who:'me', card:{id:card.id, name:card.name}, gain:card.pp||0, dpTotal:B.myDpTotal, advisor:adv, followed:adv&&adv.length ? String(adv[0].id)===String(card._uid||card.id) : null});
    B.dpStep = 'digivolve';
    renderAll();
  },

  skipDigivolveStep(){ logData('dp.skip', {step:'digivolve', advice:App._lastDigivolveAdvice||null}); B.dpStep = 'speedDigivolve'; renderAll(); },
  skipSpeedDigivolveStep(){ logData('dp.skip', {step:'speedDigivolve', advice:App._lastDigivolveAdvice||null}); B.dpStep = 'done'; renderAll(); },

  doOppSacrifice(){
    const selectId = document.getElementById('oppSacSelect').value;
    if(selectId){
      const card = findInHand(B.oppHand, selectId);
      if(card){
        B.oppDpTotal += (card.pp||0);
        removeFromOppHand(card._uid||card.id);
        logEvent(`Opponent sacrificed ${card.name} for +${card.pp||0} DP (total ${B.oppDpTotal}).`);
        logData('dp.sacrifice', {who:'opp', card:{id:card.id, name:card.name}, gain:card.pp||0, dpTotal:B.oppDpTotal});
      }
      renderDpPhase(document.getElementById('phasePanel')); renderStatePanel(); renderHeader();
      return;
    }
    const nameVal = document.getElementById('oppSacInput').value.trim();
    const amountVal = parseInt(document.getElementById('oppSacAmount').value);
    let gain = amountVal || 0;
    let label = nameVal || 'a card';
    if(nameVal){ const oc = findCardByName(nameVal); if(oc) gain = oc.pp||0; removeFromOppHand(oc ? oc.id : ''); }
    if(gain>0 || nameVal){
      B.oppDpTotal += gain;
      logEvent(`Opponent sacrificed ${label} for +${gain} DP (total ${B.oppDpTotal}).`);
      logData('dp.sacrifice', {who:'opp', card:{name:label}, gain, dpTotal:B.oppDpTotal});
    }
    renderDpPhase(document.getElementById('phasePanel')); renderStatePanel(); renderHeader();
  },

  doOppDigivolve(cardId){
    const card = findInHand(B.oppHand, cardId);
    if(!card) return;
    removeFromOppHand(card._uid||card.id);
    B.oppActive = Object.assign({}, card);
    B.oppHp = card.hp;
    B.oppDpTotal = 0;
    logEvent(`Opponent digivolved to ${card.name} (DP counter spent, reset to 0).`);
    logData('dp.digivolve', {who:'opp', via:'dp', to:cardBrief(card)});
    renderAll();
  },

  doDigivolve(cardId){
    const card = findInHand(B.myHand, cardId);
    if(!card) return;
    removeFromHand(card._uid||card.id);
    const from = cardBrief(B.myActive), hpBefore = B.myHp, dpBefore = B.myDpTotal;
    B.myActive = Object.assign({}, card);
    B.myHp = card.hp;
    B.myDpTotal = 0;
    logEvent(`You digivolved to ${card.name} (DP counter spent, reset to 0).`);
    logData('dp.digivolve', {who:'me', via:'dp', from, to:cardBrief(card), hp:{before:hpBefore, after:B.myHp}, dp:{before:dpBefore, after:0}, advice:App._lastDigivolveAdvice||null});
    B.dpStep = 'speedDigivolve';
    renderAll();
  },

  doSpeedDigivolve(cardId){
    const target = findInHand(B.myHand, cardId);
    const speedCard = findSpeedDigivolveCard(B.myHand);
    if(!target || !speedCard) return;
    removeFromHand(target._uid||target.id);
    removeFromHand(speedCard._uid||speedCard.id);
    const from = cardBrief(B.myActive), hpBefore = B.myHp;
    B.myActive = Object.assign({}, target);
    B.myHp = target.hp;
    logEvent(`You Speed Digivolved to ${target.name} using ${speedCard.name} (DP cost waived, DP total unchanged).`);
    logData('dp.digivolve', {who:'me', via:'speed', used:{id:speedCard.id, name:speedCard.name}, from, to:cardBrief(target), hp:{before:hpBefore, after:B.myHp}, dp:{before:B.myDpTotal, after:B.myDpTotal}, advice:App._lastDigivolveAdvice||null});
    B.dpStep = 'done';
    renderAll();
  },

  confirmDpDone(){
    logData('dp.done', {battle:!!(B.myActive && B.oppActive)});
    if(!B.myActive || !B.oppActive){
      logEvent(`${B.turnPlayer==='me'?'You have':'Opponent has'} no opposing active yet — battle phase skipped.`);
      endTurnAndAdvance();
      return;
    }
    B.phase = 'attack'; B.atkStep = 'pick';
    renderAll();
  },

  lockMyAttack(){
    B.myLockedAtk = document.getElementById('myAtkPick').value;
    { const rec = App._lastAttackRec || null, nm = {o:'Circle', t:'Triangle', x:'Cross'};
      logEvent(`You locked in ${nm[B.myLockedAtk]}${rec && rec.best!==B.myLockedAtk ? ' (solver suggested '+nm[rec.best]+')' : (rec ? ' (as the solver suggested)' : '')}.`);
      logData('attack.locked', {attack:B.myLockedAtk, recommended:rec?rec.best:null, followed:rec?rec.best===B.myLockedAtk:null, solver:rec}); }
    if(B.turnPlayer==='me'){
      B.atkStep = 'awaitOppSupport';
    } else {
      B.atkStep = 'myBlindSupport';
    }
    renderAttackPhase(document.getElementById('phasePanel'));
  },

  confirmOppSupportReveal(){
    const selectId = document.getElementById('oppSupportRevealSelect') ? document.getElementById('oppSupportRevealSelect').value : '';
    let card = null;
    if(selectId==='__random__'){ card = {name:'(unknown/random card)', type:'unknown', note:'', effect:''}; }
    else if(selectId) card = findInHand(B.oppHand, selectId) || null;
    else if(App._pendingOppSupportCard) card = App._pendingOppSupportCard;
    B.oppSupportRevealed = card;
    logData('attack.oppSupport', {timing:'before mine', card:card?{id:card.id, name:card.name, type:card.type}:null});
    if(card){
      logEvent(`Opponent's support: ${card.name}.`);
      if(selectId!=='__random__') removeFromOppHand(card._uid||card.id);
    }
    App._pendingOppSupportCard = null;
    B.atkStep = 'myReactiveSupport';
    renderAttackPhase(document.getElementById('phasePanel'));
    renderStatePanel();
  },

  pickMySupport(id){
    B.mySupportChoiceId = id || '';
    const name = id==='__random__' ? 'a random card from my deck' : (id ? (findInHand(B.myHand, id)||{}).name : 'no support');
    logEvent(`You committed support: ${name}.`);
    { const rec = App._lastSupport || null, picked = (id && id!=='__random__') ? findInHand(B.myHand, id) : null;
      logData('attack.mySupport', {choice: id==='__random__' ? 'random' : (picked ? {id:picked.id, name:picked.name} : null), ranking:rec, recommended:rec&&rec.length?{id:rec[0].id, name:rec[0].name}:null, followed:rec&&rec.length ? String(rec[0].id)===String(id||'') : null}); }
    if(B.turnPlayer==='me'){
      B.atkStep = 'resolve';
    } else {
      B.atkStep = 'awaitOppSupportInfo';
    }
    renderAttackPhase(document.getElementById('phasePanel'));
  },

  confirmOppSupportInfo(){
    const selectId = document.getElementById('oppSupportRevealSelect2') ? document.getElementById('oppSupportRevealSelect2').value : '';
    let card = null;
    if(selectId==='__random__'){ card = {name:'(unknown/random card)', type:'unknown', note:'', effect:''}; }
    else if(selectId) card = findInHand(B.oppHand, selectId) || null;
    else if(App._pendingOppSupportCard) card = App._pendingOppSupportCard;
    B.oppSupportRevealed = card;
    logData('attack.oppSupport', {timing:'after mine', card:card?{id:card.id, name:card.name, type:card.type}:null});
    if(card){
      logEvent(`Opponent's support (reacting to yours): ${card.name}.`);
      if(selectId!=='__random__') removeFromOppHand(card._uid||card.id);
    }
    App._pendingOppSupportCard = null;
    B.atkStep = 'resolve';
    renderAttackPhase(document.getElementById('phasePanel'));
    renderStatePanel();
  },

  resolveTurn(){
    let oppAtk = document.getElementById('oppAtkFinal').value;
    const oppAtkEntered = oppAtk;
    const iAmTurnPlayer = B.turnPlayer==='me';

    // If a random card's identity was revealed after the fact, use its real tags.
    const mySupportCard = (B.mySupportChoiceId && B.mySupportChoiceId!=='__random__') ? findInHand(B.myHand, B.mySupportChoiceId) : null;
    const myRandomReveal = (B.mySupportChoiceId==='__random__') ? App._myRandomRevealCard : null;
    const mySupportTags = mySupportCard ? parseEffectTags(effectText(mySupportCard), mySupportCard) : (myRandomReveal ? parseEffectTags(effectText(myRandomReveal), myRandomReveal) : []);

    const oppWasRandom = B.oppSupportRevealed && B.oppSupportRevealed.type==='unknown';
    const oppRandomReveal = oppWasRandom ? App._oppRandomRevealCard : null;
    const oppSupportTags = (B.oppSupportRevealed && !oppWasRandom) ? parseEffectTags(effectText(B.oppSupportRevealed), B.oppSupportRevealed) : (oppRandomReveal ? parseEffectTags(effectText(oppRandomReveal), oppRandomReveal) : []);

    // Labels the button actually pressed alongside any redirect that changed
    // which NUMBER got used -- e.g. "O (redirected to T's value)" -- so the
    // log never silently shows "O" when the real damage came from elsewhere.
    // Shows the attack that really got used: a support effect that forces or locks an attack
    // (Darkrizamon's "Both players use O") changes it after you chose.
    function usedLabel(chosen, used, isMine){
      return used && used!==chosen ? chosen.toUpperCase()+' → '+used.toUpperCase()+' (forced by a support effect)' : attackLabel(chosen, isMine);
    }
    function attackLabel(chosenAtk, isMine){
      const relevantTags = isMine ? oppSupportTags : mySupportTags; // redirects always come from the OTHER side's card
      const redirect = relevantTags.find(t=>t.type==='redirectOtherAttackValue');
      if(redirect && redirect.map[chosenAtk]){
        return chosenAtk.toUpperCase()+' (redirected to '+redirect.map[chosenAtk].toUpperCase()+"'s value)";
      }
      return chosenAtk.toUpperCase();
    }

    let unknownNote = '';
    if(oppAtk==='__unknown__'){
      const options = ['o','t','x'].map(b=>computeCell(B.myActive, B.oppActive, B.myHp, B.oppHp, B.myLockedAtk, b, mySupportTags, oppSupportTags, 0, iAmTurnPlayer));
      const allSame = options.every(c=>c.myDmg===options[0].myDmg && c.oppDmg===options[0].oppDmg && c.myHpAfter===options[0].myHpAfter && c.oppHpAfter===options[0].oppHpAfter);
      if(allSame){
        oppAtk = 'o'; // doesn't matter which -- outcome is identical either way, confirmed below
        unknownNote = ' (outcome was the same regardless of their attack, since they never got to act)';
      } else {
        // Not actually invariant -- don't guess in their favor. Assume the worst case for the player.
        let worstIdx = 0, worstNet = Infinity;
        options.forEach((c,i)=>{ const net = cellScore(c); if(net<worstNet){ worstNet=net; worstIdx=i; } });
        oppAtk = ['o','t','x'][worstIdx];
        unknownNote = ' (their actual attack was unknown and the outcome WOULD have differed by choice -- assumed their worst-case attack against you as a conservative estimate; correct this manually if you later find out what they had queued)';
      }
    }

    const hpBefore = {me:B.myHp, opp:B.oppHp};
    const cell = computeCell(B.myActive, B.oppActive, B.myHp, B.oppHp, B.myLockedAtk, oppAtk, mySupportTags, oppSupportTags, 0, iAmTurnPlayer);
    // computeCell resolves the whole bout (support HP effects first, then the strikes in
    // order), so real HP comes straight from it -- the same numbers the solver ranked on,
    // so what's applied here can't drift away from what was recommended.
    B.myHp = cell.myHpAfter;
    B.oppHp = cell.oppHpAfter;
    if(mySupportCard) removeFromHand(mySupportCard._uid||mySupportCard.id);

    const mySupportLabel = mySupportCard ? ' + '+mySupportCard.name : (myRandomReveal ? ' + random card (revealed: '+myRandomReveal.name+')' : (B.mySupportChoiceId==='__random__' ? ' + random card (unknown effect)' : ''));
    const oppSupportLabel = B.oppSupportRevealed ? ' + '+(oppRandomReveal ? 'random card (revealed: '+oppRandomReveal.name+')' : B.oppSupportRevealed.name+(oppWasRandom?' (unknown effect)':'')) : '';
    const hpEffectNote = cell.hpNotes.length ? ' ('+cell.hpNotes.join(', ')+', applied and permanent)' : '';
    const boutText = `You: ${usedLabel(B.myLockedAtk, cell.myAtk, true)} (${cell.myDmg} dmg)${mySupportLabel} vs Opponent: ${usedLabel(oppAtk, cell.oppAtk, false)} (${cell.oppDmg} dmg)${oppSupportLabel}${unknownNote}${hpEffectNote}. HP now You ${B.myHp} / Opp ${B.oppHp}.`;
    logEvent(boutText);
    logData('bout.resolved', {
      iAmTurnPlayer,
      attacks:{ me:{chosen:B.myLockedAtk, used:cell.myAtk}, opp:{entered:oppAtkEntered, assumed:oppAtk, used:cell.oppAtk} },
      support:{
        me: mySupportCard ? {card:{id:mySupportCard.id, name:mySupportCard.name}, effects:tagsBrief(mySupportTags), unmodelled:mySupportTags.unmodelled||[]}
            : (B.mySupportChoiceId==='__random__' ? {random:true, revealed:myRandomReveal?{id:myRandomReveal.id, name:myRandomReveal.name}:null, effects:tagsBrief(mySupportTags), unmodelled:mySupportTags.unmodelled||[]} : null),
        opp: B.oppSupportRevealed ? {card:{id:B.oppSupportRevealed.id, name:B.oppSupportRevealed.name}, random:oppWasRandom, revealed:oppRandomReveal?{id:oppRandomReveal.id, name:oppRandomReveal.name}:null, effects:tagsBrief(oppSupportTags), unmodelled:oppSupportTags.unmodelled||[]} : null
      },
      result:{ myDmg:cell.myDmg, oppDmg:cell.oppDmg, koMe:cell.koMe, koOpp:cell.koOpp,
               hp:{me:{before:hpBefore.me, after:B.myHp}, opp:{before:hpBefore.opp, after:B.oppHp}}, notes:cell.hpNotes,
               effectsApplied:{me:cell.myTagsUsed, opp:cell.oppTagsUsed} },
      text:boutText
    });
    if((B.mySupportChoiceId==='__random__' && !myRandomReveal) || (oppWasRandom && !oppRandomReveal)){
      logEvent(`Note: a random/unknown card's identity is still unconfirmed — its effect wasn't modeled, so the damage above may not reflect what actually happened in-game.`);
    }
    App._myRandomRevealCard = null; App._oppRandomRevealCard = null;

    if(B.oppHp<=0 || B.myHp<=0){
      if(B.oppHp<=0 && B.myHp<=0){
        logEvent('Both Digimon KO\u2019d in the same bout — check your rulebook for the tie-break.');
        logData('round.end', {winner:'both', round:B.round});
        B.myActive=null; B.myHp=0; B.oppActive=null; B.oppHp=0;
      } else if(B.oppHp<=0){
        B.myScore++;
        logEvent(`${B.oppActive.name} is KO'd! You win round ${B.round}. Your ${B.myActive.name} carries ${B.myHp} HP into the next round.`);
        logData('round.end', {winner:'me', round:B.round, koed:B.oppActive.name, carries:{card:B.myActive.name, hp:B.myHp}});
        B.oppActive=null; B.oppHp=0;
      } else {
        B.oppScore++;
        logEvent(`${B.myActive.name} is KO'd! Opponent wins round ${B.round}. Their ${B.oppActive.name} carries ${B.oppHp} HP into the next round.`);
        logData('round.end', {winner:'opp', round:B.round, koed:B.myActive.name, carries:{card:B.oppActive.name, hp:B.oppHp}});
        B.myActive=null; B.myHp=0;
      }
      // A match is won by the first player to cause 3 KOs -- stop there instead of starting another round.
      if(B.myScore>=3 || B.oppScore>=3){
        const won = B.myScore>=3;
        B.phase = 'over'; B.matchWinner = won ? 'me' : 'opp';
        logEvent(`MATCH OVER — ${won ? 'you win' : 'the opponent wins'} ${B.myScore}–${B.oppScore} after ${B.round} round${B.round===1?'':'s'}.`);
        logData('match.end', {winner:B.matchWinner, score:{me:B.myScore, opp:B.oppScore}, rounds:B.round});
        B.myLockedAtk=null; B.mySupportChoiceId=''; B.oppSupportRevealed=null;
        renderAll();
        return;
      }
      B.round++;
    }

    B.myLockedAtk=null; B.mySupportChoiceId=''; B.oppSupportRevealed=null;
    endTurnAndAdvance();
  }
};

let dbSort = {key:'id', dir:1};
let dbFilterSpec = null;

function renderDbTable(){
  const digimonRows = ALL_CARDS.filter(c=>c.type==='digimon');
  document.getElementById('dbCount').textContent = digimonRows.length;
  const q = document.getElementById('dbSearch').value.toLowerCase();
  let rows = digimonRows.filter(c=>c.name.toLowerCase().includes(q));
  if(dbFilterSpec) rows = rows.filter(c=>c.sp===dbFilterSpec);
  rows.sort((a,b)=>{
    const k=dbSort.key;
    if(a[k]<b[k]) return -1*dbSort.dir;
    if(a[k]>b[k]) return 1*dbSort.dir;
    return 0;
  });
  document.getElementById('dbBody').innerHTML = rows.map(c=>`
    <tr>
      <td>${c.id}</td><td>${c.name}${c.isPartner?' '+partnerBadge(c):''}</td><td>${c.lvl}</td>
      <td><span class="badge ${specClass(c.sp)}">${c.sp}</span></td>
      <td>${c.hp}</td><td>${c.dp}</td><td>${c.pp}</td>
      <td>${c.o}</td><td>${c.t}</td><td>${c.x}</td>
      <td style="max-width:220px">${c.xt}</td>
      <td><button class="btn small secondary" data-editid="${c.id}">EDIT</button></td>
    </tr>
  `).join('');
  document.querySelectorAll('[data-editid]').forEach(b=>b.addEventListener('click', ()=>openEditForm(b.dataset.editid)));
}

function renderSpecFilters(){
  const specs=["Fire","Water","Nature","Darkness","Rare"];
  document.getElementById('specFilters').innerHTML = specs.map(s=>`<button class="tag-btn ${dbFilterSpec===s?'active':''}" data-spec="${s}">${s}</button>`).join('') +
    `<button class="tag-btn ${!dbFilterSpec?'active':''}" data-spec="">All</button>`;
  document.querySelectorAll('#specFilters .tag-btn').forEach(b=>b.addEventListener('click', ()=>{ dbFilterSpec=b.dataset.spec||null; renderSpecFilters(); renderDbTable(); }));
}

function openEditForm(id){
  const card = ALL_CARDS.find(c=>String(c.id)===String(id)) || {id:'new_'+Date.now(),type:'digimon',name:'',lvl:'R',sp:'Fire',hp:0,dp:0,pp:0,o:0,t:0,x:0,xt:'none',note:'',isPartner:false};
  document.getElementById('ef-id').value = card.id;
  document.getElementById('ef-name').value = card.name;
  document.getElementById('ef-lvl').value = card.lvl;
  document.getElementById('ef-spec').value = card.sp;
  document.getElementById('ef-hp').value = card.hp;
  document.getElementById('ef-dp').value = card.dp;
  document.getElementById('ef-pp').value = card.pp;
  document.getElementById('ef-o').value = card.o;
  document.getElementById('ef-t').value = card.t;
  document.getElementById('ef-x').value = card.x;
  document.getElementById('ef-xt').value = card.xt;
  document.getElementById('ef-note').value = card.note;
  document.getElementById('ef-partner').checked = !!card.isPartner;
  document.getElementById('editForm').classList.add('open');
}

function wireDbTab(){
  document.querySelectorAll('#dbTable th[data-sort]').forEach(th=>{
    th.addEventListener('click', ()=>{
      const k = th.dataset.sort;
      if(dbSort.key===k) dbSort.dir*=-1; else { dbSort.key=k; dbSort.dir=1; }
      renderDbTable();
    });
  });
  document.getElementById('dbSearch').addEventListener('input', renderDbTable);
  document.getElementById('addCardBtn').addEventListener('click', ()=>openEditForm(-1));
  document.getElementById('cancelEditBtn').addEventListener('click', ()=>document.getElementById('editForm').classList.remove('open'));
  document.getElementById('saveCardBtn').addEventListener('click', async ()=>{
    const idRaw = document.getElementById('ef-id').value;
    const fields = {
      type:'digimon',
      name: document.getElementById('ef-name').value,
      lvl: document.getElementById('ef-lvl').value,
      sp: document.getElementById('ef-spec').value,
      hp: parseInt(document.getElementById('ef-hp').value)||0,
      dp: parseInt(document.getElementById('ef-dp').value)||0,
      pp: parseInt(document.getElementById('ef-pp').value)||0,
      o: parseInt(document.getElementById('ef-o').value)||0,
      t: parseInt(document.getElementById('ef-t').value)||0,
      x: parseInt(document.getElementById('ef-x').value)||0,
      xt: document.getElementById('ef-xt').value,
      note: document.getElementById('ef-note').value,
      isPartner: document.getElementById('ef-partner').checked
    };
    const isSeed = SEED_CARDS.some(c=>String(c.id)===String(idRaw));
    if(isSeed){ cardOverrides[idRaw]=fields; await saveOverrides(); }
    else if(customCards.some(c=>String(c.id)===String(idRaw))){
      const idx = customCards.findIndex(c=>String(c.id)===String(idRaw));
      customCards[idx] = Object.assign({id:idRaw}, fields);
      await saveCustomCards();
    } else { customCards.push(Object.assign({id:idRaw}, fields)); await saveCustomCards(); }
    rebuildAllCards(); renderDbTable();
    document.getElementById('editForm').classList.remove('open');
  });
  document.getElementById('resetDbBtn').addEventListener('click', async ()=>{
    if(!confirm('Reset all your card edits and remove custom cards? This cannot be undone.')) return;
    cardOverrides={}; customCards=[];
    await saveOverrides(); await saveCustomCards();
    rebuildAllCards(); renderDbTable();
  });
  document.getElementById('optSearch').addEventListener('input', renderOptionTable);
}

function renderOptionTable(){
  const optRows = ALL_CARDS.filter(c=>c.type==='option');
  document.getElementById('optCount').textContent = optRows.length;
  const q = document.getElementById('optSearch').value.toLowerCase();
  const rows = optRows.filter(o=>o.name.toLowerCase().includes(q));
  document.getElementById('optBody').innerHTML = rows.map(o=>`<tr><td style="width:180px"><b>${o.name}</b></td><td>${o.effect}</td></tr>`).join('');
}

/* ============================= COLLECTION TAB ============================= */
function renderCollectionTable(){
  const q = (document.getElementById('collectionSearch').value||'').toLowerCase();
  const rows = ALL_CARDS.filter(c=>c.name.toLowerCase().includes(q)).sort((a,b)=>a.id-b.id);
  const owned = Object.values(COLLECTION).reduce((s,n)=>s+(n||0),0);
  document.getElementById('collectionOwnedCount').textContent = owned;
  document.getElementById('collectionBody').innerHTML = rows.map(c=>`
    <tr>
      <td>${String(c.id).padStart(3,'0')}</td>
      <td>${c.name}${c.isPartner?' '+partnerBadge(c):''}</td>
      <td>${c.lvl||'—'}</td>
      <td>${c.type==='option'?'—':`<span class="badge ${specClass(c.sp)}">${c.sp}</span>`}</td>
      <td><input type="number" min="0" style="width:60px" value="${COLLECTION[c.id]||0}" data-cid="${c.id}" class="collection-count-input"></td>
    </tr>
  `).join('');
  document.querySelectorAll('.collection-count-input').forEach(inp=>{
    inp.addEventListener('change', async (e)=>{
      const n = Math.max(0, parseInt(e.target.value)||0);
      const cid = e.target.dataset.cid;
      if(n>0) COLLECTION[cid]=n; else delete COLLECTION[cid];
      await saveCollection();
      renderCollectionTable();
    });
  });
}

Object.assign(App, {
  async importCollectionBulk(){
    const lines = document.getElementById('collectionBulkInput').value.split('\n');
    let matched=0, unmatched=[];
    lines.forEach(line=>{
      const parsed = parseCollectionLine(line);
      if(!parsed || !parsed.name) return;
      const card = findCardByName(parsed.name) || (searchCards(parsed.name,{limit:1})[0]);
      if(card){ COLLECTION[card.id] = parsed.count; matched++; }
      else unmatched.push(parsed.name);
    });
    await saveCollection();
    renderCollectionTable();
    document.getElementById('collectionImportResult').innerHTML =
      `<div class="assumptions">Matched ${matched} card(s).${unmatched.length? '<br>Unmatched (fix manually below or edit the line): '+unmatched.map(u=>'"'+u+'"').join(', ') : ''}</div>`;
  },
  async clearCollection(){
    if(!confirm('Clear your entire tracked collection? This cannot be undone.')) return;
    COLLECTION = {};
    await saveCollection();
    renderCollectionTable();
  }
});

/* ============================= DECK BUILDER TAB ============================= */
let activeDeckSlot = 0;

function renderDeckTabs(){
  const el = document.getElementById('deckSlotTabs');
  el.innerHTML = [0,1,2].map(i=>{
    const d = DECKS[i];
    const label = d ? d.name : `Deck ${i+1} (empty)`;
    return `<button class="tag-btn ${activeDeckSlot===i?'active':''}" onclick="App.selectDeckSlot(${i})">${label}</button>`;
  }).join('');
}

function renderDeckEditor(){
  const el = document.getElementById('deckEditor');
  const deck = DECKS[activeDeckSlot];
  const cards = deck ? deck.cards : {};
  const total = deckTotalCount(cards);
  const breakdown = deckSpecialtyBreakdown(cards);
  const entries = Object.entries(cards).map(([id,n])=>{
    const c = ALL_CARDS.find(x=>String(x.id)===String(id));
    return c ? {card:c, n} : null;
  }).filter(Boolean).sort((a,b)=>a.card.id-b.card.id);

  el.innerHTML = `
    <div class="flex-between">
      <div>
        <label>DECK NAME</label>
        <input id="deckNameInput" value="${deck?deck.name:''}" placeholder="e.g. Red Deck" style="width:260px;display:inline-block">
        <button class="btn small secondary" onclick="App.renameDeck()">RENAME</button>
      </div>
      <div class="pill-btns">
        <button class="btn small" onclick="App.generateDeck()">GENERATE OPTIMAL DECK</button>
        <button class="btn small secondary" onclick="App.clearDeck()">CLEAR</button>
      </div>
    </div>
    <div class="score-badge" style="margin-top:10px;display:inline-block">CARDS <b>${total}</b> / 30</div>
    ${Object.entries(breakdown).map(([k,v])=>`<span class="score-badge" style="margin-left:6px">${k} <b>${v}</b></span>`).join('')}
    ${total>30 ? '<div class="warn-box">Over 30 cards — trim before using this deck in a match.</div>' : ''}

    <label style="margin-top:14px">ADD A CARD (from your collection)</label>
    <div class="search-box"><input id="deckAddInput" placeholder="Type a card name..." autocomplete="off"><div class="suggest-list" id="deckAddInput_list"></div></div>

    <label style="margin-top:12px">BULK IMPORT (paste a 30-line deck list, or "Name xN" lines — replaces this deck)</label>
    <textarea id="deckBulkInput" rows="6" placeholder="1. Tyrannomon&#10;2. Tyrannomon&#10;..."></textarea>
    <button class="btn small secondary" style="margin-top:6px" onclick="App.importDeckBulk()">IMPORT AS THIS DECK</button>
    <div id="deckImportResult" style="margin-top:8px"></div>

    <div class="db-scroll" style="margin-top:12px">
      <table class="db"><thead><tr><th>#</th><th>Name</th><th>Lvl</th><th>Specialty</th><th>In Deck</th><th>Owned</th><th></th></tr></thead>
      <tbody>
        ${entries.map(({card,n})=>`
          <tr>
            <td>${String(card.id).padStart(3,'0')}</td>
            <td>${card.name}</td>
            <td>${card.lvl||'—'}</td>
            <td>${card.type==='option'?'—':`<span class="badge ${specClass(card.sp)}">${card.sp}</span>`}</td>
            <td>${n}</td>
            <td>${COLLECTION[card.id]||0}</td>
            <td><button class="btn small secondary" onclick="App.adjustDeckCard('${card.id}',-1)">−</button>
                <button class="btn small secondary" onclick="App.adjustDeckCard('${card.id}',1)">+</button></td>
          </tr>
        `).join('')}
      </tbody></table>
    </div>
  `;
  wireSearchBox('deckAddInput', {}, (card)=>{
    App.adjustDeckCard(card.id, 1);
  });
}

Object.assign(App, {
  selectDeckSlot(i){ activeDeckSlot=i; renderDeckTabs(); renderDeckEditor(); },

  async renameDeck(){
    const name = document.getElementById('deckNameInput').value.trim() || `Deck ${activeDeckSlot+1}`;
    if(!DECKS[activeDeckSlot]) DECKS[activeDeckSlot] = {name, cards:{}};
    else DECKS[activeDeckSlot].name = name;
    await saveDecks();
    renderDeckTabs(); renderDeckEditor();
  },

  async adjustDeckCard(cardId, delta){
    if(!DECKS[activeDeckSlot]) DECKS[activeDeckSlot] = {name:`Deck ${activeDeckSlot+1}`, cards:{}};
    const deck = DECKS[activeDeckSlot];
    const owned = COLLECTION[cardId]||0;
    const current = deck.cards[cardId]||0;
    let next = current + delta;
    next = Math.max(0, Math.min(owned, MAX_DECK_COPIES, next));
    if(next>0) deck.cards[cardId]=next; else delete deck.cards[cardId];
    await saveDecks();
    renderDeckTabs(); renderDeckEditor();
  },

  async clearDeck(){
    if(!confirm('Clear this deck?')) return;
    if(DECKS[activeDeckSlot]) DECKS[activeDeckSlot].cards = {};
    await saveDecks();
    renderDeckEditor();
  },

  async generateDeck(){
    const generated = generateOptimalDeck(COLLECTION, 30);
    const name = (DECKS[activeDeckSlot] && DECKS[activeDeckSlot].name) || `Deck ${activeDeckSlot+1}`;
    DECKS[activeDeckSlot] = { name, cards: generated };
    await saveDecks();
    renderDeckTabs(); renderDeckEditor();
  },

  async importDeckBulk(){
    const lines = document.getElementById('deckBulkInput').value.split('\n');
    const cards = {}; let matched=0; const unmatched=[];
    lines.forEach(line=>{
      const parsed = parseCollectionLine(line);
      if(!parsed || !parsed.name) return;
      const card = findCardByName(parsed.name) || (searchCards(parsed.name,{limit:1})[0]);
      if(card){ cards[card.id] = (cards[card.id]||0) + parsed.count; matched++; }
      else unmatched.push(parsed.name);
    });
    // Cap at owned counts
    Object.keys(cards).forEach(id=>{ cards[id] = Math.min(cards[id], COLLECTION[id]||0); if(cards[id]<=0) delete cards[id]; });
    const name = (DECKS[activeDeckSlot] && DECKS[activeDeckSlot].name) || `Deck ${activeDeckSlot+1}`;
    DECKS[activeDeckSlot] = { name, cards };
    await saveDecks();
    renderDeckTabs(); renderDeckEditor();
    document.getElementById('deckImportResult').innerHTML =
      `<div class="assumptions">Imported ${matched} line(s), deck now has ${deckTotalCount(cards)} cards (capped at what you own).${unmatched.length? '<br>Unmatched: '+unmatched.map(u=>'"'+u+'"').join(', ') : ''}</div>`;
  }
});

function wireTabs(){
  document.querySelectorAll('nav button').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      document.querySelectorAll('nav button').forEach(b=>b.classList.remove('active'));
      document.querySelectorAll('.tabsection').forEach(s=>s.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-'+btn.dataset.tab).classList.add('active');
      if(btn.dataset.tab==='collection') renderCollectionTable();
      if(btn.dataset.tab==='decks'){ renderDeckTabs(); renderDeckEditor(); }
    });
  });
  document.getElementById('collectionSearch').addEventListener('input', renderCollectionTable);
}

(async function init(){
  await loadCardJson();
  await loadStorage();
  wireTabs();
  renderSpecFilters();
  renderDbTable();
  renderOptionTable();
  wireDbTab();
  renderAll();
})();
