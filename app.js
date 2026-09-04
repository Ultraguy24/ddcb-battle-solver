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

function parseEffectTags(text, card){
  const tags = []; if(!text) return tags;
  const fromOption = !!(card && card.type==='option');
  let m;
  if(m = /Own\s+(O|T|X|Circle|Triangle|Cross)\s+[Aa]ttack power is doubled/i.exec(text)){
    tags.push({type:'doubleOwnAttack', attack:wordToAtk(m[1])});
  }
  if(m = /Opponent'?s\s+(O|T|X|Circle|Triangle|Cross)\s+[Aa]ttack power (?:is|goes to|becomes) 0/i.exec(text)){
    tags.push({type:'zeroOppAttack', attack:wordToAtk(m[1])});
  }
  if(m = /(?:Boost|Reduce) own\s+(O|T|X|Circle|Triangle|Cross)\s+[Aa]ttack power\s*([+-]\d+)/i.exec(text)){
    tags.push({type:'boostOwnAttackSpecific', attack:wordToAtk(m[1]), amount:parseInt(m[2])});
  } else if(m = /(?:Boost|Reduce) own attack power\s*([+-]\d+)/i.exec(text)){
    tags.push({type:'boostOwnAttack', amount:parseInt(m[1])});
  }
  if(m = /Recover own HP by\s*\+?(\d+)/i.exec(text)){
    tags.push({type:'healSelf', amount:parseInt(m[1])});
  }
  if(m = /Recover foe'?s HP by\s*\+?(\d+)/i.exec(text)){
    tags.push({type:'healOpp', amount:parseInt(m[1])});
  }
  if(/Own HP are halved/i.test(text)) tags.push({type:'halveSelfHp'});
  if(/Opponent'?s HP are halved/i.test(text)) tags.push({type:'halveOppHp'});
  const hasSpecificAttackWord = /Own\s+(O|T|X|Circle|Triangle|Cross)\s+[Aa]ttack/i.test(text);
  if(/own attack power is tripled/i.test(text) && !hasSpecificAttackWord) tags.push({type:'multiplyOwnAttack', mult:3});
  if(/own attack power is doubled/i.test(text) && !hasSpecificAttackWord) tags.push({type:'multiplyOwnAttack', mult:2});
  if(/^Attack first\.?$/i.test(text.trim())) tags.push({type:'firstStrike'});
  if(/Forces? both players? (?:to use|to choose)\s*(O|T|X|Circle|Triangle|Cross)/i.exec(text) || /Both players use\s*(O|T|X)/i.exec(text)){
    const mm = /Forces? both players? (?:to use|to choose)\s*(O|T|X|Circle|Triangle|Cross)/i.exec(text) || /Both players use\s*(O|T|X)/i.exec(text);
    tags.push({type:'forceBothAttack', attack:wordToAtk(mm[1])});
  }
  if(m = /Own attack becomes\s*(O|T|X|Circle|Triangle|Cross)/i.exec(text)){
    // Genuine override -- confirmed by live play (Darkrizamon's "Both
    // players use O" family): this really does change which attack you're
    // considered to have used, not just its damage.
    tags.push({type:'lockOwnAttack', attack:wordToAtk(m[1])});
  } else if(m = /(O|T|X)\s+and\s+(O|T|X)\s+[Aa]ttack power (?:are|is|becomes) 0/i.exec(text)){
    // NOT an override -- confirmed by live play (Tsukaimon): this phrasing
    // just zeroes the two named attacks' damage. It does not redirect your
    // attack to the third (unnamed) one; if you didn't press that one, any
    // boost tied to it (e.g. "boost own X +200") simply doesn't apply either,
    // since it's still gated on the real attack pressed, not a fake one.
    const mentioned = [wordToAtk(m[1]), wordToAtk(m[2])];
    const spared = ['o','t','x'].find(a=>!mentioned.includes(a));
    if(spared) tags.push({type:'zeroOwnAttackUnless', attack:spared});
  }
  if(/Opponent'?s attack changes/i.test(text)){
    // Confirmed by live play: this genuinely changes which attack the
    // affected side is considered to have used (a real override, same as
    // "Own attack becomes X"), not just which damage number gets used.
    // (Disrupt Ray: O->T, T->X, X->O)
    tags.push({type:'redirectOtherAttackValue', map:{o:'t', t:'x', x:'o'}});
  }
  if(m = /Draw\s*(\d*|a|one)\s*cards?/i.exec(text)){
    const w = (m[1]||'').toLowerCase();
    tags.push({type:'drawCards', amount: (w==='a'||w==='one'||w==='') ? 1 : parseInt(w)});
  }

  // --- DP slot effects --------------------------------------------------
  // "DP slot" is a pile of the specific cards sacrificed for DP, not just a
  // number -- discard effects remove actual cards (most-recently-sacrificed
  // first), so these tags carry counts/flags for resolveTurn to act on
  // against the real B.myDpPile/B.oppDpPile arrays, plus (for the scaling
  // and conditional variants) feed into computeCell via dp counts.
  if(/Discard all(?: own)?(?: DP)? cards? in(?: own)? DP slot/i.test(text)){
    tags.push({type:'discardOwnDpAll'});
  } else if(m = /Discard\s*(\d+)\s*(?:DP )?cards?\s+(?:from|in)\s*own DP slot/i.exec(text)){
    tags.push({type:'discardOwnDpCount', count: parseInt(m[1])});
  }
  if(/[Dd]iscard all of (?:foe|opponent)'?s cards? in(?: his| their)? DP slot/i.test(text)){
    tags.push({type:'discardOppDpCount', count:'all'});
  } else if(m = /Discard\s*(\d+)\s*of opponent'?s cards? in(?: his| their)? DP slot/i.exec(text)){
    tags.push({type:'discardOppDpCount', count: parseInt(m[1])});
  } else if(m = /Discard opponent'?s\s*(\d*)\s*top DP cards?(?: shown)? in(?: his| their)? DP slot/i.exec(text)){
    tags.push({type:'discardOppDpCount', count: m[1] ? parseInt(m[1]) : 1});
  }
  if(/Foe discards? same number of DP cards?/i.test(text)){
    tags.push({type:'discardOppDpCount', count:'matchOwnDiscard'});
  }
  if(/Opponent discards? his hand and all cards? in his DP slot/i.test(text)){
    tags.push({type:'discardOppHand'});
    tags.push({type:'discardOppDpCount', count:'all'});
  }
  if(m = /Add(?:ed)? number of DP cards? in(?: own)? DP [Ss]lot x(\d+) to own (?:attack power|Attack power)/i.exec(text)){
    tags.push({type:'dpCountBoostAttack', per: parseInt(m[1])});
  }
  if(m = /Add(?:ed)? number of DP cards? in(?: own)? DP slot x(\d+) to own HP/i.exec(text)){
    tags.push({type:'dpCountBoostHp', per: parseInt(m[1])});
  }
  if(/Discard (?:cards? in|own) DP slot.*multiply(?:ing)? (?:own )?attack power by number of discards?/i.test(text)){
    tags.push({type:'discardOwnDpAll'});
    tags.push({type:'multiplyAttackByOwnDiscardCount'});
  }
  if(/Recover HP,?\s*number of discards? x\s*100/i.test(text)){
    tags.push({type:'healSelfPerOwnDiscard', per:100});
  }
  if(m = /If opponent has more than\s*(\d+)\s*cards? in DP slot,?\s*his attack power is 0/i.exec(text)){
    tags.push({type:'zeroOppAttackIfDpCountOver', threshold: parseInt(m[1])});
  }
  // --- end DP slot effects -----------------------------------------------

  // Conditional prefixes -- covers "if both attacks are same/different" plus
  // the much larger family of specialty/level/HP/attack-choice/hand-count
  // conditions found across the database. Each produces a condition OBJECT
  // (not just a label) with whatever it needs to be evaluated later against
  // real game state in computeCell's conditionMet(). Only one condition is
  // detected per card (matches the existing single-clause design already
  // used for attacksSame/attacksDiffer) -- applies to every tag parsed from
  // this text, same simplification as before.
  let condition = null;
  const SP = 'Fire|Water|Nature|Darkness|Dark|Rare';
  const normSp = s => s ? (s.toLowerCase()==='dark' ? 'darkness' : s.toLowerCase()) : s;
  if(/If both (?:players'? )?attacks? (?:are|is) different/i.test(text)) condition = {type:'attacksDiffer'};
  else if(/If both (?:players'? )?(?:attacks?|use the same attack)/i.test(text) && /same/i.test(text)) condition = {type:'attacksSame'};
  else if(m = new RegExp(`If (?:foe'?s|opponent'?s) [Ss]pecialty is (?:not )?(${SP})(?: or (${SP}))?`, 'i').exec(text)){
    const negate = /is not/i.test(m[0]);
    const sps = [normSp(m[1]), normSp(m[2])].filter(Boolean);
    condition = {type:'specialtyOpp', sp:sps, negate};
  }
  else if(m = new RegExp(`If opponent is (${SP})\\b`, 'i').exec(text)){
    condition = {type:'specialtyOpp', sp:[normSp(m[1])]};
  }
  else if(new RegExp(`If own [Ss]pecialty is (${SP})`, 'i').test(text)){
    const mm = new RegExp(`If own [Ss]pecialty is (${SP})`, 'i').exec(text);
    condition = {type:'specialtyOwn', sp:[normSp(mm[1])]};
  }
  else if(/If both players'? specialt(?:y|ies) (?:are|is) the same/i.test(text)){
    condition = {type:'specialtySame'};
  }
  else if(m = /If opponent'?s level is\s*([RCUA])\b/i.exec(text)){
    condition = {type:'levelOpp', lvl:m[1].toUpperCase()};
  }
  else if(m = /If opponent is level\s*([RCUA])\b/i.exec(text)){
    condition = {type:'levelOpp', lvl:m[1].toUpperCase()};
  }
  else if(m = /If own level is\s*([RCUA])\b/i.exec(text)){
    condition = {type:'levelOwn', lvl:m[1].toUpperCase()};
  }
  else if(/If both levels are\s*([RCUA])\b/i.test(text)){
    const mm = /If both levels are\s*([RCUA])\b/i.exec(text);
    condition = {type:'bothLevels', lvl:mm[1].toUpperCase()};
  }
  else if(/If own level is lower/i.test(text) || /If own level is below opponent'?s/i.test(text)){
    condition = {type:'levelRelative', cmp:'lower'};
  }
  else if(m = /If own HP (?:are|is) less than\s*(\d+)/i.exec(text)){
    condition = {type:'hpOwn', cmp:'lt', value:parseInt(m[1])};
  }
  else if(/If own HP (?:are|is) more than opponent'?s HP/i.test(text)){
    condition = {type:'hpRelative', cmp:'gt'}; // own > opp
  }
  else if(/If HP is less than opponent'?s/i.test(text) || /If own HP is less than foe'?s HP/i.test(text)){
    condition = {type:'hpRelative', cmp:'lt'}; // own < opp
  }
  else if(m = /If opponent'?s HP (?:are|is) (?:more than\s*(\d+)|(\d+)\+)/i.exec(text)){
    condition = {type:'hpOpp', cmp:'gte', value:parseInt(m[1]||m[2])};
  }
  else if(/If opponent'?s HP is less than own/i.test(text)){
    condition = {type:'hpRelative', cmp:'gt'}; // own > opp (i.e. opp < own)
  }
  else if(m = /If own Attack is\s*(O|T|X|Circle|Triangle|Cross)\b/i.exec(text)){
    condition = {type:'attackOwn', atk:wordToAtk(m[1]), negate:/is not/i.test(text)};
  }
  else if(m = /If opponent (?:used|uses)\s*(O|T|X|Circle|Triangle|Cross)\b/i.exec(text)){
    condition = {type:'attackOpp', atk:wordToAtk(m[1])};
  }
  else if(m = /If own cards? in hand is\s*(\d+)\s*or more/i.exec(text)){
    condition = {type:'handCountOwn', cmp:'gte', value:parseInt(m[1])};
  }
  else if(m = /If\s*(\d+)\s*or less cards? left in own hand/i.exec(text)){
    condition = {type:'handCountOwn', cmp:'lte', value:parseInt(m[1])};
  }
  if(condition) tags.forEach(t=>{ t.condition = condition; });
  tags.forEach(t=>{ t.fromOption = fromOption; });
  return tags;
}

// --- DP pile helpers -------------------------------------------------
// The DP slot is a pile of the specific Digimon cards sacrificed for DP, in
// sacrifice order (index 0 = first/oldest, last index = most recently
// sacrificed / "top" of the pile). Total DP is always derived from the pile
// so it can never drift out of sync with what's actually in it.
function dpPileTotal(pile){ return (pile||[]).reduce((s,c)=>s+(c.pp||0), 0); }
function dpPileCount(pile){ return (pile||[]).length; }
function dpPileDiscardTop(pile, count){
  // Removes up to `count` cards from the top (most recent end) of the pile,
  // returns the discarded cards (for logging / moving to the Offline Deck).
  const n = Math.min(count, pile.length);
  return pile.splice(pile.length - n, n);
}
// Applies discard-DP-slot tags from one side's support text: own-side
// discards first (so a "foe discards the same number" tag on the same card
// knows how many that was), then any effect targeting the opponent's pile.
// Returns how many of the OWN pile's cards were discarded, for chaining.
function applyDpSlotEffects(tags, ownPile, oppPile, ownLabel, oppLabel){
  let ownDiscardedCount = 0;
  tags.forEach(tag=>{
    if(tag.type==='discardOwnDpAll' || tag.type==='discardOwnDpCount'){
      const n = tag.type==='discardOwnDpAll' ? ownPile.length : tag.count;
      const removed = dpPileDiscardTop(ownPile, n);
      ownDiscardedCount += removed.length;
      if(removed.length) logEvent(`${ownLabel} discarded ${removed.length} DP card(s) (${removed.map(c=>c.name).join(', ')}) from the DP slot.`);
    }
  });
  tags.forEach(tag=>{
    if(tag.type==='discardOppDpCount'){
      let n = tag.count;
      if(n==='all') n = oppPile.length;
      else if(n==='matchOwnDiscard') n = ownDiscardedCount;
      const removed = dpPileDiscardTop(oppPile, n);
      if(removed.length) logEvent(`${oppLabel} had ${removed.length} DP card(s) (${removed.map(c=>c.name).join(', ')}) discarded from their DP slot.`);
    }
  });
  return ownDiscardedCount;
}

function computeCell(myCard, oppCard, myHp, oppHp, a, b, mySupportTags, oppSupportTags, hiddenBuffer, iAmTurnPlayer, myDpCount, oppDpCount, myHandCount, oppHandCount){
  mySupportTags = mySupportTags||[]; oppSupportTags = oppSupportTags||[]; hiddenBuffer = hiddenBuffer||0;
  myDpCount = myDpCount||0; oppDpCount = oppDpCount||0;
  myHandCount = myHandCount||0; oppHandCount = oppHandCount||0;
  const origA = a, origB = b;
  // Evaluates a tag's condition from the perspective of whichever side
  // played the card (isMine=true for mySupportTags, false for oppSupportTags)
  // -- "own"/"opponent" in the card text always means relative to the player
  // who chose to play it as support, not a fixed side.
  function conditionMet(tag, isMine){
    if(!tag.condition) return true;
    const c = tag.condition;
    const ownCard = isMine ? myCard : oppCard, foeCard = isMine ? oppCard : myCard;
    const ownHp = isMine ? myHp : oppHp, foeHp = isMine ? oppHp : myHp;
    const ownAtk = isMine ? origA : origB, foeAtk = isMine ? origB : origA;
    const ownHandCount = isMine ? myHandCount : oppHandCount;
    switch(c.type){
      case 'attacksDiffer': return origA !== origB;
      case 'attacksSame': return origA === origB;
      case 'specialtyOpp': { const m = c.sp.includes((foeCard.sp||'').toLowerCase()); return c.negate ? !m : m; }
      case 'specialtyOwn': return c.sp.includes((ownCard.sp||'').toLowerCase());
      case 'specialtySame': return (ownCard.sp||'').toLowerCase() === (foeCard.sp||'').toLowerCase();
      case 'levelOpp': return (foeCard.lvl||'').toUpperCase() === c.lvl;
      case 'levelOwn': return (ownCard.lvl||'').toUpperCase() === c.lvl;
      case 'bothLevels': return (ownCard.lvl||'').toUpperCase()===c.lvl && (foeCard.lvl||'').toUpperCase()===c.lvl;
      case 'levelRelative': {
        // Level ordering uncertain for where Armor (A) sits relative to R/C/U
        // for "lower/higher" comparisons -- treated as equal-to-Rookie tier
        // pending confirmation. Flag if this ever matters in a real report.
        const order = {R:0, A:0, C:1, U:2};
        const ov = order[(ownCard.lvl||'R').toUpperCase()] ?? 0;
        const fv = order[(foeCard.lvl||'R').toUpperCase()] ?? 0;
        return c.cmp==='lower' ? ov<fv : ov>fv;
      }
      case 'hpOwn': return c.cmp==='lt' ? ownHp<c.value : ownHp>=c.value;
      case 'hpOpp': return c.cmp==='lt' ? foeHp<c.value : foeHp>=c.value;
      case 'hpRelative': return c.cmp==='gt' ? ownHp>foeHp : ownHp<foeHp;
      case 'attackOwn': { const m = ownAtk===c.atk; return c.negate ? !m : m; }
      case 'attackOpp': return foeAtk===c.atk;
      case 'handCountOwn': return c.cmp==='gte' ? ownHandCount>=c.value : ownHandCount<=c.value;
      default: return true;
    }
  }
  mySupportTags = mySupportTags.filter(t=>conditionMet(t, true));
  oppSupportTags = oppSupportTags.filter(t=>conditionMet(t, false));

  // Jamming: "Opponent's Support Effect is Voided. Can't Void Option Effect."
  // Only triggers when its owner presses Cross, like every other xt ability.
  if(a==='x' && xtGrantsJamming(myCard.xt)){
    oppSupportTags = oppSupportTags.filter(t=>t.fromOption);
  }
  if(b==='x' && xtGrantsJamming(oppCard.xt)){
    mySupportTags = mySupportTags.filter(t=>t.fromOption);
  }

  mySupportTags.concat(oppSupportTags).forEach(tag=>{
    if(tag.type==='forceBothAttack'){ a = tag.attack; b = tag.attack; }
  });
  mySupportTags.forEach(tag=>{ if(tag.type==='lockOwnAttack'){ a = tag.attack; } });
  oppSupportTags.forEach(tag=>{ if(tag.type==='lockOwnAttack'){ b = tag.attack; } });

  // Attack-redirect effects (e.g. Disrupt Ray): confirmed by live play to
  // genuinely change which attack the affected side is considered to have
  // used, same as any other "attack becomes X" override -- NOT a value-only
  // swap. (Evidence: opponent's O-to-0 Cross ability correctly triggered
  // against a player who had pressed X but was redirected to O by Disrupt
  // Ray -- that only happens if the actual attack changed, not just the
  // damage number.)
  mySupportTags.forEach(tag=>{ if(tag.type==='redirectOtherAttackValue'){ b = tag.map[b]; } });
  oppSupportTags.forEach(tag=>{ if(tag.type==='redirectOtherAttackValue'){ a = tag.map[a]; } });

  // Counter Attack: "If Opponent uses [X] Attack, it will miss. Then you
  // counter with opponent's [X] attack power." Only live when its owner
  // presses Cross (hence these cards print X:0 -- that's the whiff fallback
  // when the opponent doesn't pick the matching attack).
  const myCounter = a==='x' ? parseCounterTag(myCard.xt) : null;
  const oppCounter = b==='x' ? parseCounterTag(oppCard.xt) : null;
  const myCountering = myCounter && myCounter.toLowerCase()===b;
  const oppCountering = oppCounter && oppCounter.toLowerCase()===a;

  // Crash: "Attack Power becomes same as HP. HP becomes 10. No Effect until
  // just before attack." -- the "just before attack" clause means Crash's
  // power is evaluated at the moment THAT SIDE actually throws its attack,
  // not at the start of the bout. If the crasher goes second, that's their
  // HP *after* taking the first attacker's hit.
  const myCrashing = a==='x' && isCrashXTag(myCard.xt);
  const oppCrashing = b==='x' && isCrashXTag(oppCard.xt);

  // First-strike order must be known before Crash power can be evaluated.
  const iCanSteal = activeGrantsFirstStrike(myCard, a) || mySupportTags.some(t=>t.type==='firstStrike');
  const oppCanSteal = activeGrantsFirstStrike(oppCard, b) || oppSupportTags.some(t=>t.type==='firstStrike');
  let myGoesFirst;
  if(iAmTurnPlayer===undefined || iAmTurnPlayer===null){
    myGoesFirst = iCanSteal && !oppCanSteal ? true : (!iCanSteal && oppCanSteal ? false : null);
  } else {
    const turnPlayerHasFirst = iAmTurnPlayer ? iCanSteal : oppCanSteal;
    const nonTurnPlayerHasFirst = iAmTurnPlayer ? oppCanSteal : iCanSteal;
    const turnPlayerGoesFirst = !(nonTurnPlayerHasFirst && !turnPlayerHasFirst);
    myGoesFirst = iAmTurnPlayer ? turnPlayerGoesFirst : !turnPlayerGoesFirst;
  }

  function applyBoosts(base, isMine){
    let dmg = base;
    const tags = isMine ? mySupportTags : oppSupportTags;
    const atk = isMine ? a : b;
    const ownDpCount = isMine ? myDpCount : oppDpCount;
    tags.forEach(tag=>{
      if(tag.type==='boostOwnAttack') dmg += tag.amount;
      if(tag.type==='boostOwnAttackSpecific' && tag.attack===atk) dmg += tag.amount;
      if(tag.type==='doubleOwnAttack' && tag.attack===atk) dmg *= 2;
      if(tag.type==='multiplyOwnAttack') dmg *= tag.mult;
      if(tag.type==='dpCountBoostAttack') dmg += tag.per * ownDpCount;
      if(tag.type==='multiplyAttackByOwnDiscardCount') dmg *= Math.max(1, ownDpCount);
      if(tag.type==='zeroOwnAttackUnless' && tag.attack!==atk) dmg = 0;
    });
    return Math.max(0, dmg);
  }

  let myDmg, oppDmg;
  if(myGoesFirst===true){
    myDmg = applyBoosts(myCountering ? baseVal(oppCard, b) : (myCrashing ? myHp : effectiveDamage(myCard, a, oppCard)), true);
    const oppHpAfterMyHit = oppCrashing ? Math.max(0, oppHp - myDmg) : oppHp;
    oppDmg = (oppCrashing && oppHpAfterMyHit<=0) ? 0 :
      applyBoosts(oppCountering ? baseVal(myCard, a) : (oppCrashing ? oppHpAfterMyHit : effectiveDamage(oppCard, b, myCard)), false);
  } else if(myGoesFirst===false){
    oppDmg = applyBoosts(oppCountering ? baseVal(myCard, a) : (oppCrashing ? oppHp : effectiveDamage(oppCard, b, myCard)), false);
    const myHpAfterOppHit = myCrashing ? Math.max(0, myHp - oppDmg) : myHp;
    myDmg = (myCrashing && myHpAfterOppHit<=0) ? 0 :
      applyBoosts(myCountering ? baseVal(oppCard, b) : (myCrashing ? myHpAfterOppHit : effectiveDamage(myCard, a, oppCard)), true);
  } else {
    // Simultaneous, no established order -- each side's Crash power (if any)
    // uses their own pre-bout HP, since neither has attacked yet.
    myDmg = applyBoosts(myCountering ? baseVal(oppCard, b) : (myCrashing ? myHp : effectiveDamage(myCard, a, oppCard)), true);
    oppDmg = applyBoosts(oppCountering ? baseVal(myCard, a) : (oppCrashing ? oppHp : effectiveDamage(oppCard, b, myCard)), false);
  }

  mySupportTags.forEach(tag=>{ if(tag.type==='zeroOppAttack' && (!tag.attack || tag.attack===b)) oppDmg = 0; });
  oppSupportTags.forEach(tag=>{ if(tag.type==='zeroOppAttack' && (!tag.attack || tag.attack===a)) myDmg = 0; });
  mySupportTags.forEach(tag=>{ if(tag.type==='zeroOppAttackIfDpCountOver' && oppDpCount>tag.threshold) oppDmg = 0; });
  oppSupportTags.forEach(tag=>{ if(tag.type==='zeroOppAttackIfDpCountOver' && myDpCount>tag.threshold) myDmg = 0; });

  if(myCountering) oppDmg = 0; // their matching attack "misses"
  if(oppCountering) myDmg = 0;
  if(a==='x'){ const neg=parseNegateTag(myCard.xt); if(neg && neg.toLowerCase()===b) oppDmg=0; }
  if(b==='x'){ const neg=parseNegateTag(oppCard.xt); if(neg && neg.toLowerCase()===a) myDmg=0; }

  myDmg = Math.max(0, Math.round(myDmg));
  oppDmg = Math.max(0, Math.round(oppDmg));

  if(myGoesFirst===true){
    if(myDmg>=oppHp) oppDmg=0;
  } else if(myGoesFirst===false){
    if(oppDmg>=myHp) myDmg=0;
  }

  if(hiddenBuffer) oppDmg += hiddenBuffer;

  // HP-modifying effects (healing, halving, Crash's HP-to-10, Eat-up-HP
  // lifesteal) -- these change actual HP totals, separate from the damage
  // swing used for solver ranking. The resolver applies these to real HP.
  let myHealAmt = 0, oppHealAmt = 0, myHalve = false, oppHalve = false;
  let mySetHp = null, oppSetHp = null;
  mySupportTags.forEach(tag=>{
    if(tag.type==='healSelf') myHealAmt += tag.amount;
    if(tag.type==='healOpp') oppHealAmt += tag.amount;
    if(tag.type==='halveSelfHp') myHalve = true;
    if(tag.type==='halveOppHp') oppHalve = true;
    if(tag.type==='dpCountBoostHp') myHealAmt += tag.per * myDpCount;
    if(tag.type==='healSelfPerOwnDiscard') myHealAmt += tag.per * myDpCount;
  });
  oppSupportTags.forEach(tag=>{
    if(tag.type==='healSelf') oppHealAmt += tag.amount;
    if(tag.type==='healOpp') myHealAmt += tag.amount;
    if(tag.type==='halveSelfHp') oppHalve = true;
    if(tag.type==='halveOppHp') myHalve = true;
    if(tag.type==='dpCountBoostHp') oppHealAmt += tag.per * oppDpCount;
    if(tag.type==='healSelfPerOwnDiscard') oppHealAmt += tag.per * oppDpCount;
  });
  if(a==='x' && isEatUpHpXTag(myCard.xt)) myHealAmt += myDmg;
  if(b==='x' && isEatUpHpXTag(oppCard.xt)) oppHealAmt += oppDmg;
  if(myCrashing) mySetHp = 10;
  if(oppCrashing) oppSetHp = 10;

  return { myDmg, oppDmg, koOpp: myDmg>=oppHp, koMe: oppDmg>=myHp, myHealAmt, oppHealAmt, myHalve, oppHalve, mySetHp, oppSetHp };
}

function computeMatrix(myCard, oppCard, myHp, oppHp, mySupportTags, hiddenBuffer, iAmTurnPlayer, myDpCount, oppDpCount, myHandCount, oppHandCount){
  const atks=['o','t','x'];
  const grid = {};
  atks.forEach(a=>{ grid[a]={}; atks.forEach(b=>{
    grid[a][b] = computeCell(myCard, oppCard, myHp, oppHp, a, b, mySupportTags, [], hiddenBuffer, iAmTurnPlayer, myDpCount, oppDpCount, myHandCount, oppHandCount);
  }); });
  return grid;
}
function maximin(grid){
  const atks=['o','t','x'];
  let best=null, bestVal=-Infinity;
  atks.forEach(a=>{
    let worst=Infinity;
    atks.forEach(b=>{ const net = grid[a][b].myDmg - grid[a][b].oppDmg; if(net<worst) worst=net; });
    if(worst>bestVal){ bestVal=worst; best=a; }
  });
  return {best, bestVal};
}

function rankSupportOptions(myCard, oppCard, myHp, oppHp, fixedA, hand, oppSupportTagsKnown, hiddenBuffer, iAmTurnPlayer, myDpCount, oppDpCount){
  const candidates = [{id:'', name:'— none —', tags:[]}].concat(
    hand.map(c=>({id:String(c._uid||c.id), name:c.name + (c.type==='option'?' (option)':''), tags:parseEffectTags(effectText(c), c)}))
  );
  return candidates.map(cand=>{
    let worst = Infinity;
    ['o','t','x'].forEach(b=>{
      const cell = computeCell(myCard, oppCard, myHp, oppHp, fixedA, b, cand.tags, oppSupportTagsKnown||[], hiddenBuffer||0, iAmTurnPlayer);
      const net = cell.myDmg - cell.oppDmg;
      if(net<worst) worst = net;
    });
    return { id:cand.id, name:cand.name, worst };
  }).sort((x,y)=>y.worst-x.worst);
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
    if(t.type==='zeroOppAttack'){ score+=100; notes.push('Support can zero an opponent attack outright.'); }
    if(t.type==='doubleOwnAttack'){ score+=70; notes.push('Support can double one of its own attacks.'); }
    if(t.type==='boostOwnAttack'){ score+=t.amount/5; notes.push(`Support boosts all attacks by +${t.amount}.`); }
    if(t.type==='boostOwnAttackSpecific'){ score+=t.amount/8; notes.push(`Support boosts its ${(t.attack||'?').toUpperCase()} by +${t.amount}.`); }
    if(t.type==='healSelf'){ score+=t.amount/6; notes.push(`Support heals +${t.amount} HP.`); }
    if(t.type==='halveSelfHp'){ score-=80; notes.push('Support halves own HP — risky.'); }
    if(t.type==='halveOppHp'){ score+=60; notes.push('Support halves opponent HP.'); }
    if(t.type==='forceBothAttack'){ score+=20; notes.push(`Support forces both players onto ${(t.attack||'?').toUpperCase()} — situational.`); }
  });
  if(/draw \d* ?cards?/i.test(txt)){ score+=30; notes.push('Support draws a card — card advantage.'); }
  return {score, notes};
}

function rankEntranceCandidates(hand, oppActive, oppHp){
  const candidates = hand.filter(c=>c.type==='digimon').map(c=>adjustForEntrance(c));
  return candidates.map(card=>{
    const eff = effectQualityNote(card);
    let matchupVal = null;
    if(oppActive){
      const grid = computeMatrix(card, oppActive, card.hp, (oppHp!=null?oppHp:oppActive.hp), [], 0, true);
      matchupVal = maximin(grid).bestVal;
    }
    const avgAtk = Math.round((card.o+card.t+card.x)/3);
    const heuristic = Math.round(card.hp/10 + avgAtk/5 + eff.score);
    return { card, matchupVal, heuristic, notes:eff.notes, avgAtk };
  }).sort((a,b)=>{
    if(a.matchupVal!==null && b.matchupVal!==null) return b.matchupVal-a.matchupVal;
    return b.heuristic-a.heuristic;
  });
}

function rankSupportOptionsOpenInfo(myCard, oppCard, myHp, oppHp, fixedA, myHand, oppHandCards, iAmTurnPlayer, myDpCount, oppDpCount){
  const myCandidates = [{id:'', name:'— none —', tags:[]}].concat(
    myHand.map(c=>({id:String(c._uid||c.id), name:c.name + (c.type==='option'?' (option)':''), tags:parseEffectTags(effectText(c), c)}))
  );
  const oppSupportCandidates = [[]].concat(
    (oppHandCards||[]).map(c=>parseEffectTags(effectText(c), c))
  );
  return myCandidates.map(cand=>{
    let worst = Infinity;
    ['o','t','x'].forEach(b=>{
      oppSupportCandidates.forEach(oppTags=>{
        const cell = computeCell(myCard, oppCard, myHp, oppHp, fixedA, b, cand.tags, oppTags, 0, iAmTurnPlayer, myDpCount, oppDpCount);
        const net = cell.myDmg - cell.oppDmg;
        if(net<worst) worst = net;
      });
    });
    return { id:cand.id, name:cand.name, worst };
  }).sort((x,y)=>y.worst-x.worst);
}

// Expected value of playing a random card from what's actually left in your
// selected deck -- weighted by remaining count, using worst-case-vs-opponent
// for each possible random draw (randomness on your side => expectation is
// the right lens; the opponent's response is still treated adversarially).
// oppSupportSets: either a single known tag array, or an array of possible
// tag arrays (e.g. from their tracked hand) to treat as opponent options too.
function randomCardExpectedValue(myCard, oppCard, myHp, oppHp, fixedA, oppSupportSets, hiddenBuffer, iAmTurnPlayer, myDpCount, oppDpCount){
  const remaining = getRemainingDeckList();
  if(!remaining.length) return null;
  const sets = (oppSupportSets.length && Array.isArray(oppSupportSets[0])) ? oppSupportSets : [oppSupportSets||[]];
  const total = remaining.reduce((s,r)=>s+r.count, 0);
  let weightedSum = 0;
  remaining.forEach(({card, count})=>{
    const tags = parseEffectTags(effectText(card), card);
    let worst = Infinity;
    ['o','t','x'].forEach(b=>{
      sets.forEach(oppTags=>{
        const cell = computeCell(myCard, oppCard, myHp, oppHp, fixedA, b, tags, oppTags, hiddenBuffer||0, iAmTurnPlayer, myDpCount, oppDpCount);
        const net = cell.myDmg - cell.oppDmg;
        if(net<worst) worst = net;
      });
    });
    weightedSum += worst * count;
  });
  return { ev: Math.round(weightedSum/total), poolSize: total };
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
    const canAdd = Math.min(owned_-already, maxCopies-already, targetSize-total);
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
// Scores digivolve/speed-digivolve targets against the opponent's current
// active (worst-case net damage, same maximin logic as entrance/sacrifice
// ranking), plus a "stay as current active" baseline so digivolving isn't
// always assumed to be correct just because a target is eligible.
function rankDigivolveOptions(currentActive, currentHp, targets, oppActive, oppHp){
  function valueOf(card, hp){
    if(!oppActive) return null;
    const grid = computeMatrix(card, oppActive, hp, (oppHp!=null?oppHp:oppActive.hp), [], 0, true);
    return maximin(grid).bestVal;
  }
  const stayVal = valueOf(currentActive, currentHp);
  const ranked = targets.map(card=>({ card, matchupVal: valueOf(card, card.hp) }))
    .sort((a,b)=> (b.matchupVal||0) - (a.matchupVal||0));
  return { ranked, stayVal };
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
  myDpTotal:0, oppDpTotal:0, myDpPile:[], oppDpPile:[],
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
};

function logEvent(text){ B.log.unshift({round:B.round, text}); renderLog(); }

function newDuel(){
  Object.assign(B, {
    myScore:0, oppScore:0, round:1, turnPlayer:'me',
    myActive:null, oppActive:null, myHp:0, oppHp:0,
    myDpTotal:0, oppDpTotal:0, myDpPile:[], oppDpPile:[], myHand:[], oppHand:[], phase:'deckselect',
    atkStep:'pick', myLockedAtk:null, mySupportChoiceId:'', oppSupportRevealed:null,
    selectedDeckId:null, deckUsedThisMatch:{},
    log:[]
  });
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
  B.dpStep = null;
}

function endTurnAndAdvance(){
  const next = B.turnPlayer==='me' ? 'opp' : 'me';
  beginTurnPhaseFor(next);
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
      <div class="col"><label>YOUR ACTIVE</label>${cardMiniPreview(B.myActive, B.myHp)}
        ${B.myActive ? `<div class="small-note" style="margin-top:4px">Correct HP if it's ever wrong: <input type="number" id="myHpOverride" value="${B.myHp}" style="width:70px;display:inline-block"> <button class="btn small secondary" onclick="App.applyHpOverride('me')">SET</button></div>` : ''}
      </div>
      <div class="col"><label>OPPONENT'S ACTIVE</label>${cardMiniPreview(B.oppActive, B.oppHp)}
        ${B.oppActive ? `<div class="small-note" style="margin-top:4px">Correct HP if it's ever wrong: <input type="number" id="oppHpOverride" value="${B.oppHp}" style="width:70px;display:inline-block"> <button class="btn small secondary" onclick="App.applyHpOverride('opp')">SET</button></div>` : ''}
      </div>
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
    renderStatePanel();
    renderPhase();
  });
  if(ignoreFilterBox) ignoreFilterBox.addEventListener('change', renderStatePanel);
  wireSearchBox('oppHandSearch', {}, (card)=>{
    if(B.oppHand.length>=4){ alert("Opponent's hand is already at 4 cards."); return; }
    B.oppHand.push(withUid(card));
    renderStatePanel();
    renderPhase();
  });
  document.querySelectorAll('#handChips [data-remove]').forEach(chip=>{
    chip.addEventListener('click', ()=>{ removeFromHand(chip.dataset.remove); renderStatePanel(); renderPhase(); });
  });
  document.querySelectorAll('#oppHandChips [data-oppremove]').forEach(chip=>{
    chip.addEventListener('click', ()=>{ removeFromOppHand(chip.dataset.oppremove); renderStatePanel(); renderPhase(); });
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
  const ranked = isMe ? rankEntranceCandidates(B.myHand, oppKnown, B.oppHp) : [];

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
          <span class="val">${r.matchupVal!==null ? (r.matchupVal>=0?'+':'')+r.matchupVal+' worst-case' : 'score '+r.heuristic}</span>
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
// Digivolving isn't just a stat upgrade -- it fully resets HP to the new
// form's printed value. When critically low, banking DP toward a digivolve
// you don't have in hand yet is a real defensive play, not just a vague
// "future value" -- estimate what that's actually worth using the real
// card pool (same specialty, one level up) rather than a flat multiplier
// that's too small to ever matter. This can't know what's actually left in
// THIS deck (already-drawn/sacrificed copies aren't tracked here), so it's
// discounted as an uncertain, several-turns-out payoff, not a sure thing.
function estimateDigivolveEscapeValue(myActive, myHp){
  if(!myActive || myHp==null) return 0;
  const nextLevel = {R:'C', C:'U', A:'C'}[myActive.lvl];
  if(!nextLevel) return 0;
  const candidates = ALL_CARDS.filter(c=>c.type==='digimon' && c.sp===myActive.sp && c.lvl===nextLevel);
  if(!candidates.length) return 0;
  const avgHp = candidates.reduce((s,c)=>s+c.hp,0) / candidates.length;
  const restorePotential = Math.max(0, avgHp - myHp);
  // Discounted hard: this depends on actually drawing a matching card later,
  // which isn't guaranteed. ~20% reflects "plausible within a few turns if
  // your deck has the usual 2 copies," not "will definitely happen."
  return restorePotential * 0.2;
}

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
  // Standing still has a real cost when you're endangered AND have no path to
  // digivolve right now -- staying a fragile low-tier form while low on HP is
  // itself a risk, not a neutral default.
  const standStillPenalty = (!baselineEvo.length && urgency>1) ? Math.round(-20*urgency) : 0;
  results.push({
    id:'', name:'— sacrifice nothing —',
    note: baselineEvo.length ? `You already have ${baselineEvo.length} eligible digivolve target(s) at your current ${myDpTotal} DP.` :
      (standStillPenalty ? `No eligible digivolve targets, and your HP is low enough that staying put carries real risk (${standStillPenalty} for doing nothing).` : `No eligible digivolve targets yet at your current ${myDpTotal} DP.`),
    score: standStillPenalty
  });

  digimonCandidates.forEach(card=>{
    const remainingHand = hand.filter(c=>String(c.id)!==String(card.id));
    const newDp = myDpTotal + (card.pp||0);
    const beforeEvo = myActive ? digivolveOptions(myActive, myDpTotal, remainingHand) : [];
    const afterEvo = myActive ? digivolveOptions(myActive, newDp, remainingHand) : [];
    const newlyUnlocked = afterEvo.filter(e=>!beforeEvo.some(b=>String(b.id)===String(e.id)));
    const eff = effectQualityNote(card);
    const avgAtk = Math.round((card.o+card.t+card.x)/3);
    const opportunityCost = Math.round(card.hp/10 + avgAtk/5 + eff.score);
    let score = (card.pp||0) - opportunityCost;
    let note = `+${card.pp||0} DP (would bring your total to ${newDp}).`;
    if(newlyUnlocked.length){
      score += 200;
      note += ` Unlocks digivolving into ${newlyUnlocked.map(e=>e.name).join(', ')} THIS turn.`;
    } else {
      const baseBonus = bankingBonus(myDpTotal, card.pp||0);
      let bonus = Math.round(baseBonus * urgency);
      // The old flat urgency multiplier alone tops out far too small to ever
      // outweigh a real card's opportunity cost -- add the actual escape-hatch
      // value (restoring HP via a plausible future same-specialty digivolve),
      // scaled in only as urgency climbs above baseline.
      const escapeValue = myActive ? estimateDigivolveEscapeValue(myActive, myHp) : 0;
      const escapeBonus = Math.round(escapeValue * (urgency-1)/2);
      bonus += escapeBonus;
      if(bonus>0){
        score += bonus;
        note += urgency>1
          ? ` No immediate target, but your HP is low enough that banked DP is a real escape hatch — digivolving refreshes to full HP (+${bonus} urgent banking value, ${urgency}x${escapeBonus>0?`, incl. ~${escapeBonus} for realistic HP-restore potential`:''}).`
          : ` No immediate target, but banks progress toward a future digivolve (+${bonus} banking value).`;
      }
    }
    if(eff.notes.length) note += ' Giving up: ' + eff.notes.join(' ');
    results.push({ id:String(card._uid||card.id), name:card.name, note, score });
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
    });
    return;
  }

  if(!B.dpStep) B.dpStep = 'sacrifice';
  if(B.dpStep==='digivolve'){
    const evoOptions = digivolveOptions(active, dpTotal, B.myHand);
    if(!evoOptions.length) B.dpStep = 'speedDigivolve';
  }
  if(B.dpStep==='speedDigivolve'){
    const speedCard = findSpeedDigivolveCard(B.myHand);
    const speedOptions = speedCard ? speedDigivolveOptions(active, B.myHand.filter(c=>c._uid!==speedCard._uid)) : [];
    if(!speedCard || !speedOptions.length) B.dpStep = 'done';
  }

  if(B.dpStep==='sacrifice') return renderDpSacrificeStep(el, active, dpTotal);
  if(B.dpStep==='digivolve') return renderDpDigivolveStep(el, active, dpTotal);
  if(B.dpStep==='speedDigivolve') return renderDpSpeedDigivolveStep(el, active, dpTotal);
  return renderDpDoneStep(el, active, dpTotal);
}

function renderDpSacrificeStep(el, active, dpTotal){
  const sacRanked = rankSacrificeOptions(active, dpTotal, B.myHand, B.myHp);
  el.innerHTML = `
    <h2>▸ DP PHASE — STEP 1/3: SACRIFICE</h2>
    <div class="small-note">Sacrificing for DP and digivolving in the same turn are both allowed together. Pick one, or skip — either way this moves you to the next step.</div>
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
  const { ranked, stayVal } = rankDigivolveOptions(active, B.myHp, evoOptions, B.oppActive, B.oppHp);
  const stayNote = stayVal!=null ? `<div class="small-note">Staying as ${active.name} (no digivolve): worst-case net ${stayVal}</div>` : '';
  el.innerHTML = `
    <h2>▸ DP PHASE — STEP 2/3: DIGIVOLVE (current DP: ${dpTotal})</h2>
    <div class="small-note">Eligible now that your DP is banked. Ranked by worst-case matchup value against the opponent's active, best first. Pick one, or skip.</div>
    ${stayNote}
    ${ranked.map(r=>`
      <div class="suggestion-rank">
        <span><b>${r.card.name}</b> (${r.card.lvl}, needs ${r.card.dp} DP) — HP ${r.card.hp}, O ${r.card.o}/T ${r.card.t}/X ${r.card.x}${r.matchupVal!=null?` — worst-case net ${r.matchupVal}`:''}</span>
        <button class="btn small" onclick="App.doDigivolve('${r.card._uid}')">DIGIVOLVE</button>
      </div>
    `).join('')}
    <button class="btn secondary small" style="margin-top:10px" onclick="App.skipDigivolveStep()">SKIP</button>
  `;
}

function renderDpSpeedDigivolveStep(el, active, dpTotal){
  const speedCard = findSpeedDigivolveCard(B.myHand);
  const speedOptions = speedDigivolveOptions(active, B.myHand.filter(c=>c._uid!==speedCard._uid));
  const { ranked, stayVal } = rankDigivolveOptions(active, B.myHp, speedOptions, B.oppActive, B.oppHp);
  const stayNote = stayVal!=null ? `<div class="small-note">Staying as ${active.name} (no digivolve): worst-case net ${stayVal}</div>` : '';
  el.innerHTML = `
    <h2>▸ DP PHASE — STEP 3/3: SPEED DIGIVOLVE (${speedCard.name} in hand — ignores DP cost)</h2>
    <div class="small-note">Ranked by worst-case matchup value against the opponent's active, best first. Pick one, or skip.</div>
    ${stayNote}
    ${ranked.map(r=>`
      <div class="suggestion-rank">
        <span><b>${r.card.name}</b> (${r.card.lvl}, DP cost waived) — HP ${r.card.hp}, O ${r.card.o}/T ${r.card.t}/X ${r.card.x}${r.matchupVal!=null?` — worst-case net ${r.matchupVal}`:''}</span>
        <button class="btn small" onclick="App.doSpeedDigivolve('${r.card._uid}')">SPEED DIGIVOLVE</button>
      </div>
    `).join('')}
    <button class="btn secondary small" style="margin-top:10px" onclick="App.skipSpeedDigivolveStep()">SKIP</button>
  `;
}

function renderDpDoneStep(el, active, dpTotal){
  el.innerHTML = `
    <h2>▸ DP PHASE COMPLETE</h2>
    <div class="small-note">Active: <b>${active.name}</b> — DP banked: <b>${dpTotal}</b></div>
    <button class="btn" style="margin-top:12px" onclick="App.confirmDpDone()">CONTINUE →</button>
  `;
}


function renderAttackPhase(el){
  if(!B.myActive || !B.oppActive){ el.innerHTML = '<div class="small-note">Missing active Digimon on one side — this phase should not be reachable yet.</div>'; return; }
  const iAmTurnPlayer = B.turnPlayer==='me';

  if(B.atkStep==='pick'){
    const grid = computeMatrix(B.myActive, B.oppActive, B.myHp, B.oppHp, [], 0, iAmTurnPlayer, B.myDpPile.length, B.oppDpPile.length, B.myHand.length, B.oppHand.length);
    const rec = maximin(grid);
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
        <div class="reason">Worst-case net HP swing assuming they play optimally: <b>${rec.bestVal>=0?'+':''}${rec.bestVal}</b>.</div>
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
    const ranked = rankSupportOptions(B.myActive, B.oppActive, B.myHp, B.oppHp, B.myLockedAtk, B.myHand, oppTags, 0, iAmTurnPlayer, B.myDpPile.length, B.oppDpPile.length);
    const redirectTag = oppTags.find(t=>t.type==='redirectOtherAttackValue');
    const redirectWarning = redirectTag ? `<div class="warn-box">${B.oppSupportRevealed.name} changes your locked ${B.myLockedAtk.toUpperCase()} into <b>${redirectTag.map[B.myLockedAtk].toUpperCase()}</b> for real — it's treated as if you'd pressed ${redirectTag.map[B.myLockedAtk].toUpperCase()} the whole time. Support you pick that boosts "${B.myLockedAtk.toUpperCase()}" specifically will no longer apply; the opponent's Cross ability (if tied to ${redirectTag.map[B.myLockedAtk].toUpperCase()}) can now trigger instead. Scored against the redirected attack below.</div>` : '';
    const randomEv = getSelectedDeck() ? randomCardExpectedValue(B.myActive, B.oppActive, B.myHp, B.oppHp, B.myLockedAtk, oppTags, 0, iAmTurnPlayer, B.myDpPile.length, B.oppDpPile.length) : null;
    const combined = ranked.map(r=>({id:r.id, name:r.name, val:r.worst, note:null}));
    if(randomEv){
      combined.push({id:'__random__', name:'Play a random card from my deck', val:randomEv.ev, note:`Expected value across the ${randomEv.poolSize} cards still unaccounted for in your tracked deck.`, approx:true});
    } else {
      combined.push({id:'__random__', name:'Play a random card from my deck', val:null, note:"Unknown effect — can't be scored (select a deck to get a real estimate here)."});
    }
    combined.sort((a,b)=>(b.val==null?-Infinity:b.val)-(a.val==null?-Infinity:a.val));
    el.innerHTML = `
      <h2>▸ YOUR SUPPORT (REACTING)</h2>
      <div class="small-note">You locked ${B.myLockedAtk.toUpperCase()}. Opponent's support: <b>${B.oppSupportRevealed?B.oppSupportRevealed.name:'none'}</b>. Ranked by worst-case outcome against their 3 possible attacks:</div>
      ${redirectWarning}
      ${combined.map((r,i)=>`
        <div class="suggestion-rank ${i===0?'top':''}">
          <span>${r.name}${r.note?'<br><span class="small-note">'+r.note+'</span>':''}</span>
          ${r.val!=null ? `<span class="val">${r.approx?'~':''}${r.val>=0?'+':''}${r.val}</span>` : ''}
          <button class="btn small secondary" onclick="App.pickMySupport('${r.id}')">USE</button>
        </div>`).join('')}
    `;
    return;
  }

  if(B.atkStep==='myBlindSupport'){
    const ranked = rankSupportOptionsOpenInfo(B.myActive, B.oppActive, B.myHp, B.oppHp, B.myLockedAtk, B.myHand, B.oppHand, iAmTurnPlayer, B.myDpPile.length, B.oppDpPile.length);
    const oppPossibleSets = [[]].concat(B.oppHand.map(c=>parseEffectTags(effectText(c), c)));
    const randomEv = getSelectedDeck() ? randomCardExpectedValue(B.myActive, B.oppActive, B.myHp, B.oppHp, B.myLockedAtk, oppPossibleSets, 0, iAmTurnPlayer, B.myDpPile.length, B.oppDpPile.length) : null;
    const combined = ranked.map(r=>({id:r.id, name:r.name, val:r.worst, note:null}));
    if(randomEv){
      combined.push({id:'__random__', name:'Play a random card from my deck', val:randomEv.ev, note:`Expected value across the ${randomEv.poolSize} cards still unaccounted for in your tracked deck.`, approx:true});
    } else {
      combined.push({id:'__random__', name:'Play a random card from my deck', val:null, note:"Unknown effect — can't be scored (select a deck to get a real estimate here)."});
    }
    combined.sort((a,b)=>(b.val==null?-Infinity:b.val)-(a.val==null?-Infinity:a.val));
    el.innerHTML = `
      <h2>▸ YOUR SUPPORT (COMMITTING BLIND)</h2>
      <div class="small-note">It's the opponent's turn, so you (non-turn player) must commit support first. You locked ${B.myLockedAtk.toUpperCase()}. Since their hand is visible, this is the true worst case across all 3 of their attacks and every support card actually in their hand (${B.oppHand.length} tracked) — not a guess.</div>
      <div id="rankedSupportList">
        ${combined.map((r,i)=>`
          <div class="suggestion-rank ${i===0?'top':''}">
            <span>${r.name}${r.note?'<br><span class="small-note">'+r.note+'</span>':''}</span>
            ${r.val!=null ? `<span class="val">${r.approx?'~':''}${r.val>=0?'+':''}${r.val}</span>` : ''}
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

  if(B.atkStep==='declareDraw'){
    const needMe = (B.pendingMyDraw||0) > 0;
    const needOpp = (B.pendingOppDraw||0) > 0;
    el.innerHTML = `
      <h2>▸ SUPPORT DRAW EFFECT${(B.pendingMyDraw+B.pendingOppDraw)>1?'S':''}</h2>
      <div class="small-note">A support card played this bout draws a card. Declare what was drawn so hand tracking stays accurate.</div>
      ${needMe ? `
        <label style="margin-top:10px">YOU DREW (${B.pendingMyDraw} remaining) — search for the card</label>
        <div class="search-box"><input id="myDrawInput" placeholder="Card name" autocomplete="off"><div class="suggest-list" id="myDrawInput_list"></div></div>
        <button class="btn small" style="margin-top:6px" onclick="App.declareMyDrawCard()">ADD TO MY HAND</button>
        <button class="btn small secondary" style="margin-top:6px" onclick="App.skipDrawDeclare('me')">SKIP (DON'T KNOW)</button>
      ` : ''}
      ${needOpp ? `
        <label style="margin-top:14px">OPPONENT DREW (${B.pendingOppDraw} remaining) — search for the card</label>
        <div class="search-box"><input id="oppDrawInput" placeholder="Card name" autocomplete="off"><div class="suggest-list" id="oppDrawInput_list"></div></div>
        <button class="btn small" style="margin-top:6px" onclick="App.declareOppDrawCard()">ADD TO THEIR TRACKED HAND</button>
        <button class="btn small secondary" style="margin-top:6px" onclick="App.skipDrawDeclare('opp')">SKIP (DON'T KNOW)</button>
      ` : ''}
      ${(!needMe && !needOpp) ? `<button class="btn" style="margin-top:14px" onclick="App.finishDrawDeclare()">CONTINUE →</button>` : ''}
    `;
    if(needMe) wireSearchBox('myDrawInput', {}, (card)=>{
      document.getElementById('myDrawInput').value = card.name;
      App._pendingMyDrawCard = card;
    });
    if(needOpp) wireSearchBox('oppDrawInput', {}, (card)=>{
      document.getElementById('oppDrawInput').value = card.name;
      App._pendingOppDrawCard = card;
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
      ` : ''}
      ${oppWasRandom ? `
        <label style="margin-top:12px">OPPONENT'S RANDOM CARD WAS REVEALED AS (if you know now)</label>
        <div class="search-box"><input id="oppRandomReveal" placeholder="Card name, if revealed" autocomplete="off"><div class="suggest-list" id="oppRandomReveal_list"></div></div>
      ` : ''}
      <button class="btn" style="margin-top:14px" onclick="App.resolveTurn()">RESOLVE TURN</button>
    `;
    if(myWasRandom) wireSearchBox('myRandomReveal', {}, (card)=>{
      document.getElementById('myRandomReveal').value = card.name;
      App._myRandomRevealCard = card;
    });
    if(oppWasRandom) wireSearchBox('oppRandomReveal', {}, (card)=>{
      document.getElementById('oppRandomReveal').value = card.name;
      App._oppRandomRevealCard = card;
    });
    return;
  }
}

function renderLog(){
  const el = document.getElementById('logList');
  el.innerHTML = `
    <button class="btn small secondary" style="margin-bottom:8px" onclick="App.copyLog()">COPY FULL LOG</button>
    ${B.log.map(e=>`<div class="log-entry"><span class="tag">R${e.round}</span>${e.text}</div>`).join('') || '<div class="small-note">No events yet.</div>'}
  `;
}

function renderAll(){ renderHeader(); renderStatePanel(); renderPhase(); renderLog(); }

const App = {
  newDuel(){ if(confirm('Reset the whole duel (score, hand, DP totals)?')) newDuel(); },

  confirmDraw(){
    B.phase = activeFor(B.turnPlayer) ? 'dp' : 'entrance';
    renderAll();
  },

  selectDeckForMatch(i){
    B.selectedDeckId = i;
    B.deckUsedThisMatch = {};
    logEvent(`Using deck: ${DECKS[i].name} (${deckTotalCount(DECKS[i].cards)} cards).`);
    B.phase = 'kickoff';
    renderAll();
  },

  skipDeckSelection(){
    B.selectedDeckId = null;
    B.phase = 'kickoff';
    renderAll();
  },

  setKickoff(who){
    beginTurnPhaseFor(who);
    logEvent(who==='me' ? 'You go first this match.' : 'Opponent goes first this match.');
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
    App._entrancePicked = null;
    B.phase = 'dp';
    renderAll();
  },

  doSacrifice(id){
    if(!id){ logEvent('You chose not to sacrifice this turn.'); B.dpStep = 'digivolve'; renderDpPhase(document.getElementById('phasePanel')); return; }
    const card = findInHand(B.myHand, id);
    if(!card) return;
    B.myDpPile.push(card);
    B.myDpTotal = dpPileTotal(B.myDpPile);
    removeFromHand(card._uid||card.id);
    logEvent(`You sacrificed ${card.name} for +${card.pp||0} DP (total ${B.myDpTotal}).`);
    B.dpStep = 'digivolve';
    renderDpPhase(document.getElementById('phasePanel'));
    renderStatePanel(); renderHeader();
  },

  copyLog(){
    // B.log is stored newest-first (unshift); flip to chronological order for
    // a readable paste, oldest event first.
    const text = B.log.slice().reverse().map(e=>`R${e.round} ${e.text}`).join('\n');
    if(navigator.clipboard && navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(
        ()=>logEvent('Full log copied to clipboard.'),
        ()=>alert('Could not copy automatically — select and copy the log manually.')
      );
    } else {
      alert('Clipboard access unavailable — select and copy the log manually.');
    }
  },

  applyHpOverride(who){
    const el = document.getElementById(who==='me'?'myHpOverride':'oppHpOverride');
    if(!el) return;
    const val = parseInt(el.value);
    if(isNaN(val) || val<0){ alert('Enter a valid non-negative number.'); return; }
    if(who==='me'){ B.myHp = val; logEvent(`Manually corrected your HP to ${val}.`); }
    else { B.oppHp = val; logEvent(`Manually corrected opponent's HP to ${val}.`); }
    renderStatePanel(); renderHeader();
  },

  skipDigivolveStep(){
    B.dpStep = 'speedDigivolve';
    renderDpPhase(document.getElementById('phasePanel'));
  },

  skipSpeedDigivolveStep(){
    B.dpStep = 'done';
    renderDpPhase(document.getElementById('phasePanel'));
  },

  doOppSacrifice(){
    const selectId = document.getElementById('oppSacSelect').value;
    if(selectId){
      const card = findInHand(B.oppHand, selectId);
      if(card){
        B.oppDpPile.push(card);
        B.oppDpTotal = dpPileTotal(B.oppDpPile);
        removeFromOppHand(card._uid||card.id);
        logEvent(`Opponent sacrificed ${card.name} for +${card.pp||0} DP (total ${B.oppDpTotal}).`);
      }
      renderDpPhase(document.getElementById('phasePanel')); renderStatePanel(); renderHeader();
      return;
    }
    const nameVal = document.getElementById('oppSacInput').value.trim();
    const amountVal = parseInt(document.getElementById('oppSacAmount').value);
    let gain = amountVal || 0;
    let label = nameVal || 'a card';
    let pseudoCard = null;
    if(nameVal){ const oc = findCardByName(nameVal); if(oc){ gain = oc.pp||0; pseudoCard = oc; } removeFromOppHand(oc ? oc.id : ''); }
    if(gain>0 || nameVal){
      B.oppDpPile.push(pseudoCard || {name:label, pp:gain});
      B.oppDpTotal = dpPileTotal(B.oppDpPile);
      logEvent(`Opponent sacrificed ${label} for +${gain} DP (total ${B.oppDpTotal}).`);
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
    B.oppDpPile = [];
    logEvent(`Opponent digivolved to ${card.name} (DP counter spent, reset to 0).`);
    renderAll();
  },

  doDigivolve(cardId){
    const card = findInHand(B.myHand, cardId);
    if(!card) return;
    removeFromHand(card._uid||card.id);
    B.myActive = Object.assign({}, card);
    B.myHp = card.hp;
    B.myDpTotal = 0;
    B.myDpPile = [];
    logEvent(`You digivolved to ${card.name} (DP counter spent, reset to 0).`);
    renderAll();
  },

  doSpeedDigivolve(cardId){
    const target = findInHand(B.myHand, cardId);
    const speedCard = findSpeedDigivolveCard(B.myHand);
    if(!target || !speedCard) return;
    removeFromHand(target._uid||target.id);
    removeFromHand(speedCard._uid||speedCard.id);
    B.myActive = Object.assign({}, target);
    B.myHp = target.hp;
    logEvent(`You Speed Digivolved to ${target.name} using ${speedCard.name} (DP cost waived, DP total unchanged).`);
    renderAll();
  },

  confirmDpDone(){
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
    const iAmTurnPlayer = B.turnPlayer==='me';

    // If a random card's identity was revealed after the fact, use its real tags.
    const mySupportCard = (B.mySupportChoiceId && B.mySupportChoiceId!=='__random__') ? findInHand(B.myHand, B.mySupportChoiceId) : null;
    const myRandomReveal = (B.mySupportChoiceId==='__random__') ? App._myRandomRevealCard : null;
    const mySupportTags = mySupportCard ? parseEffectTags(effectText(mySupportCard), mySupportCard) : (myRandomReveal ? parseEffectTags(effectText(myRandomReveal), myRandomReveal) : []);

    const oppWasRandom = B.oppSupportRevealed && B.oppSupportRevealed.type==='unknown';
    const oppRandomReveal = oppWasRandom ? App._oppRandomRevealCard : null;
    const oppSupportTags = (B.oppSupportRevealed && !oppWasRandom) ? parseEffectTags(effectText(B.oppSupportRevealed), B.oppSupportRevealed) : (oppRandomReveal ? parseEffectTags(effectText(oppRandomReveal), oppRandomReveal) : []);

    // Labels the button actually pressed alongside any redirect that changed
    // it to a genuinely different attack -- e.g. "X (changed to O)" -- so the
    // log never silently shows "X" when the real attack used was different.
    function attackLabel(chosenAtk, isMine){
      const ownTags = isMine ? mySupportTags : oppSupportTags;
      const otherTags = isMine ? oppSupportTags : mySupportTags;
      // Disrupt Ray-style: the OTHER side's card redirects THIS side's attack.
      const redirect = otherTags.find(t=>t.type==='redirectOtherAttackValue');
      if(redirect && redirect.map[chosenAtk] && redirect.map[chosenAtk]!==chosenAtk){
        return chosenAtk.toUpperCase()+' (changed to '+redirect.map[chosenAtk].toUpperCase()+')';
      }
      // "Own attack becomes X"-style: THIS side's own card overrides its own attack.
      const lock = ownTags.find(t=>t.type==='lockOwnAttack');
      if(lock && lock.attack!==chosenAtk){
        return chosenAtk.toUpperCase()+' (changed to '+lock.attack.toUpperCase()+')';
      }
      // "Both players use X"-style: either side's card forces both attacks.
      const force = ownTags.concat(otherTags).find(t=>t.type==='forceBothAttack');
      if(force && force.attack!==chosenAtk){
        return chosenAtk.toUpperCase()+' (changed to '+force.attack.toUpperCase()+')';
      }
      return chosenAtk.toUpperCase();
    }

    let unknownNote = '';
    if(oppAtk==='__unknown__'){
      const options = ['o','t','x'].map(b=>computeCell(B.myActive, B.oppActive, B.myHp, B.oppHp, B.myLockedAtk, b, mySupportTags, oppSupportTags, 0, iAmTurnPlayer, B.myDpPile.length, B.oppDpPile.length, B.myHand.length, B.oppHand.length));
      const allSame = options.every(c=>c.myDmg===options[0].myDmg && c.oppDmg===options[0].oppDmg);
      if(allSame){
        oppAtk = 'o'; // doesn't matter which -- outcome is identical either way, confirmed below
        unknownNote = ' (outcome was the same regardless of their attack, since they never got to act)';
      } else {
        // Not actually invariant -- don't guess in their favor. Assume the worst case for the player.
        let worstIdx = 0, worstNet = Infinity;
        options.forEach((c,i)=>{ const net = c.myDmg - c.oppDmg; if(net<worstNet){ worstNet=net; worstIdx=i; } });
        oppAtk = ['o','t','x'][worstIdx];
        unknownNote = ' (their actual attack was unknown and the outcome WOULD have differed by choice -- assumed their worst-case attack against you as a conservative estimate; correct this manually if you later find out what they had queued)';
      }
    }

    const cell = computeCell(B.myActive, B.oppActive, B.myHp, B.oppHp, B.myLockedAtk, oppAtk, mySupportTags, oppSupportTags, 0, iAmTurnPlayer, B.myDpPile.length, B.oppDpPile.length, B.myHand.length, B.oppHand.length);
    B.oppHp = Math.max(0, B.oppHp - cell.myDmg);
    B.myHp = Math.max(0, B.myHp - cell.oppDmg);
    // HP-modifying effects (heals are typically confirmed permanent; applied after the damage exchange).
    if(cell.myHalve) B.myHp = Math.floor(B.myHp/2);
    if(cell.oppHalve) B.oppHp = Math.floor(B.oppHp/2);
    if(cell.myHealAmt) B.myHp += cell.myHealAmt;
    if(cell.oppHealAmt) B.oppHp += cell.oppHealAmt;
    // Crash: HP is set to exactly 10 as the cost of the attack -- overrides everything else above.
    if(cell.mySetHp!=null) B.myHp = cell.mySetHp;
    if(cell.oppSetHp!=null) B.oppHp = cell.oppSetHp;
    if(mySupportCard) removeFromHand(mySupportCard._uid||mySupportCard.id);

    // DP slot discard effects -- resolved using the pre-discard counts that
    // already fed into cell's damage/heal math above, so this can't retroactively
    // change what just happened this bout, only what's banked going forward.
    applyDpSlotEffects(mySupportTags, B.myDpPile, B.oppDpPile, 'You', 'Opponent');
    applyDpSlotEffects(oppSupportTags, B.oppDpPile, B.myDpPile, 'Opponent', 'You');
    B.myDpTotal = dpPileTotal(B.myDpPile);
    B.oppDpTotal = dpPileTotal(B.oppDpPile);
    mySupportTags.forEach(tag=>{ if(tag.type==='discardOppHand' && B.oppHand.length){
      logEvent(`Opponent discarded their entire hand (${B.oppHand.map(c=>c.name).join(', ')}).`);
      B.oppHand = [];
    }});
    oppSupportTags.forEach(tag=>{ if(tag.type==='discardOppHand' && B.myHand.length){
      logEvent(`You discarded your entire hand (${B.myHand.map(c=>c.name).join(', ')}).`);
      B.myHand = [];
    }});

    const mySupportLabel = mySupportCard ? ' + '+mySupportCard.name : (myRandomReveal ? ' + random card (revealed: '+myRandomReveal.name+')' : (B.mySupportChoiceId==='__random__' ? ' + random card (unknown effect)' : ''));
    const oppSupportLabel = B.oppSupportRevealed ? ' + '+(oppRandomReveal ? 'random card (revealed: '+oppRandomReveal.name+')' : B.oppSupportRevealed.name+(oppWasRandom?' (unknown effect)':'')) : '';
    let hpEffectNote = '';
    if(cell.myHealAmt || cell.oppHealAmt || cell.myHalve || cell.oppHalve || cell.mySetHp!=null || cell.oppSetHp!=null){
      const parts = [];
      if(cell.myHealAmt) parts.push(`you recovered ${cell.myHealAmt} HP`);
      if(cell.oppHealAmt) parts.push(`opponent recovered ${cell.oppHealAmt} HP`);
      if(cell.myHalve) parts.push(`your HP was halved`);
      if(cell.oppHalve) parts.push(`opponent's HP was halved`);
      if(cell.mySetHp!=null) parts.push(`your HP became ${cell.mySetHp} (Crash)`);
      if(cell.oppSetHp!=null) parts.push(`opponent's HP became ${cell.oppSetHp} (Crash)`);
      hpEffectNote = ' ('+parts.join(', ')+', applied and permanent)';
    }
    logEvent(`You: ${attackLabel(B.myLockedAtk, true)} (${cell.myDmg} dmg)${mySupportLabel} vs Opponent: ${attackLabel(oppAtk, false)} (${cell.oppDmg} dmg)${oppSupportLabel}${unknownNote}${hpEffectNote}. HP now You ${B.myHp} / Opp ${B.oppHp}.`);
    if((B.mySupportChoiceId==='__random__' && !myRandomReveal) || (oppWasRandom && !oppRandomReveal)){
      logEvent(`Note: a random/unknown card's identity is still unconfirmed — its effect wasn't modeled, so the damage above may not reflect what actually happened in-game.`);
    }
    App._myRandomRevealCard = null; App._oppRandomRevealCard = null;

    if(B.oppHp<=0 || B.myHp<=0){
      if(B.oppHp<=0 && B.myHp<=0){
        logEvent('Both Digimon KO\u2019d in the same bout — check your rulebook for the tie-break.');
        B.myActive=null; B.myHp=0; B.oppActive=null; B.oppHp=0;
      } else if(B.oppHp<=0){
        B.myScore++;
        logEvent(`${B.oppActive.name} is KO'd! You win round ${B.round}. Your ${B.myActive.name} carries ${B.myHp} HP into the next round.`);
        B.oppActive=null; B.oppHp=0;
      } else {
        B.oppScore++;
        logEvent(`${B.myActive.name} is KO'd! Opponent wins round ${B.round}. Their ${B.oppActive.name} carries ${B.oppHp} HP into the next round.`);
        B.myActive=null; B.myHp=0;
      }
      B.round++;
    }

    B.myLockedAtk=null; B.mySupportChoiceId=''; B.oppSupportRevealed=null;

    const myDrawAmt = mySupportTags.filter(t=>t.type==='drawCards').reduce((s,t)=>s+t.amount,0);
    const oppDrawAmt = oppSupportTags.filter(t=>t.type==='drawCards').reduce((s,t)=>s+t.amount,0);
    if(myDrawAmt>0 || oppDrawAmt>0){
      B.pendingMyDraw = myDrawAmt; B.pendingOppDraw = oppDrawAmt;
      B.atkStep = 'declareDraw';
      renderAll();
      return;
    }
    endTurnAndAdvance();
  },

  declareMyDrawCard(){
    const card = App._pendingMyDrawCard;
    if(!card){ logEvent('Pick a card first.'); return; }
    B.myHand.push(withUid(card));
    logEvent(`You drew ${card.name} (from support draw effect) — added to hand.`);
    App._pendingMyDrawCard = null;
    B.pendingMyDraw--;
    renderAll();
  },

  declareOppDrawCard(){
    const card = App._pendingOppDrawCard;
    if(!card){ logEvent('Pick a card first.'); return; }
    B.oppHand.push(withUid(card));
    logEvent(`Opponent drew ${card.name} (from support draw effect) — added to their tracked hand.`);
    App._pendingOppDrawCard = null;
    B.pendingOppDraw--;
    renderAll();
  },

  skipDrawDeclare(who){
    if(who==='me') B.pendingMyDraw = 0; else B.pendingOppDraw = 0;
    logEvent(`${who==='me'?'You':'Opponent'} drew a card from a support effect, but its identity wasn't declared — hand size may be under-tracked from here.`);
    renderAll();
  },

  finishDrawDeclare(){
    B.atkStep = null;
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
    next = Math.max(0, Math.min(owned, next));
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
