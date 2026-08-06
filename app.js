let SEED_CARDS = [];
let cardOverrides = {};
let customCards = [];
let ALL_CARDS = [];

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

async function loadStorage(){
  try{ const r = await window.storage.get('card_overrides'); if(r && r.value) cardOverrides = JSON.parse(r.value); }catch(e){ cardOverrides = {}; }
  try{ const r2 = await window.storage.get('custom_cards'); if(r2 && r2.value) customCards = JSON.parse(r2.value); }catch(e){ customCards = []; }
  rebuildAllCards();
}
async function saveOverrides(){ try{ await window.storage.set('card_overrides', JSON.stringify(cardOverrides)); }catch(e){} }
async function saveCustomCards(){ try{ await window.storage.set('custom_cards', JSON.stringify(customCards)); }catch(e){} }

function findCardByName(name){
  if(!name) return null;
  const n = name.trim().toLowerCase();
  return ALL_CARDS.find(c=>c.name.toLowerCase()===n) || null;
}
function searchCards(query, opts={}){
  const q = (query||'').trim().toLowerCase();
  let pool = ALL_CARDS;
  if(opts.type) pool = pool.filter(c=>c.type===opts.type);
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
function parseFoeMultiplier(xt){
  const m = /^(fire|water|nature|darkness|rare)\s+foe\s+x(\d+)$/i.exec((xt||"").trim());
  if(!m) return null;
  return { spec: m[1][0].toUpperCase()+m[1].slice(1).toLowerCase(), mult: parseInt(m[2]) };
}
function parseNegateTag(xt){
  const m = /^(O|T|X)\s+to\s+0$/i.exec((xt||"").trim());
  return m ? m[1].toUpperCase() : null;
}
function isFirstStrikeXTag(xt){ return /^1st attack$/i.test((xt||"").trim()); }
function baseVal(card, atk){ return atk==='o'?card.o: atk==='t'?card.t: card.x; }

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

function parseEffectTags(text){
  const tags = []; if(!text) return tags;
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
    tags.push({type:'lockOwnAttack', attack:wordToAtk(m[1])});
  } else if(m = /(O|T|X)\s+and\s+(O|T|X)\s+[Aa]ttack power (?:are|is|becomes) 0/i.exec(text)){
    const mentioned = [wordToAtk(m[1]), wordToAtk(m[2])];
    const locked = ['o','t','x'].find(a=>!mentioned.includes(a));
    if(locked) tags.push({type:'lockOwnAttack', attack:locked});
  }
  if(/Opponent'?s attack changes/i.test(text)){
    // Confirmed by play: this swaps only which damage NUMBER is used, not which
    // button was pressed -- own X/T/O-triggered abilities still key off the
    // original chosen attack, not the redirected one. (Disrupt Ray: O->T, T->X, X->O)
    tags.push({type:'redirectOtherAttackValue', map:{o:'t', t:'x', x:'o'}});
  }
  // Common "if both attacks are the same/different" conditional prefix --
  // applies to whatever effect(s) the rest of the sentence produced above.
  let condition = null;
  if(/If both (?:players'? )?attacks? (?:are|is) different/i.test(text)) condition = 'attacksDiffer';
  else if(/If both (?:players'? )?(?:attacks?|use the same attack)/i.test(text) && /same/i.test(text)) condition = 'attacksSame';
  if(condition) tags.forEach(t=>{ t.condition = condition; });
  return tags;
}

function computeCell(myCard, oppCard, myHp, oppHp, a, b, mySupportTags, oppSupportTags, hiddenBuffer, iAmTurnPlayer){
  mySupportTags = mySupportTags||[]; oppSupportTags = oppSupportTags||[]; hiddenBuffer = hiddenBuffer||0;
  const origA = a, origB = b;
  function conditionMet(tag){
    if(!tag.condition) return true;
    if(tag.condition==='attacksDiffer') return origA !== origB;
    if(tag.condition==='attacksSame') return origA === origB;
    return true;
  }
  mySupportTags = mySupportTags.filter(conditionMet);
  oppSupportTags = oppSupportTags.filter(conditionMet);

  mySupportTags.concat(oppSupportTags).forEach(tag=>{
    if(tag.type==='forceBothAttack'){ a = tag.attack; b = tag.attack; }
  });
  mySupportTags.forEach(tag=>{ if(tag.type==='lockOwnAttack'){ a = tag.attack; } });
  oppSupportTags.forEach(tag=>{ if(tag.type==='lockOwnAttack'){ b = tag.attack; } });

  // Value-only redirects (e.g. Disrupt Ray): change which damage NUMBER is used
  // without changing which attack was actually "pressed" -- own-attack-triggered
  // abilities (negation, foe multipliers, first strike) still key off a/b as-is.
  let aVal = a, bVal = b;
  mySupportTags.forEach(tag=>{ if(tag.type==='redirectOtherAttackValue'){ bVal = tag.map[b]; } });
  oppSupportTags.forEach(tag=>{ if(tag.type==='redirectOtherAttackValue'){ aVal = tag.map[a]; } });

  let myDmg = effectiveDamage(myCard, a, oppCard, aVal);
  let oppDmg = effectiveDamage(oppCard, b, myCard, bVal);

  mySupportTags.forEach(tag=>{
    if(tag.type==='boostOwnAttack') myDmg += tag.amount;
    if(tag.type==='boostOwnAttackSpecific' && tag.attack===a) myDmg += tag.amount;
    if(tag.type==='doubleOwnAttack' && tag.attack===a) myDmg *= 2;
    if(tag.type==='multiplyOwnAttack') myDmg *= tag.mult;
    if(tag.type==='zeroOppAttack' && (!tag.attack || tag.attack===b)) oppDmg = 0;
  });
  oppSupportTags.forEach(tag=>{
    if(tag.type==='boostOwnAttack') oppDmg += tag.amount;
    if(tag.type==='boostOwnAttackSpecific' && tag.attack===b) oppDmg += tag.amount;
    if(tag.type==='doubleOwnAttack' && tag.attack===b) oppDmg *= 2;
    if(tag.type==='multiplyOwnAttack') oppDmg *= tag.mult;
    if(tag.type==='zeroOppAttack' && (!tag.attack || tag.attack===a)) myDmg = 0;
  });

  if(a==='x'){ const neg=parseNegateTag(myCard.xt); if(neg && neg.toLowerCase()===b) oppDmg=0; }
  if(b==='x'){ const neg=parseNegateTag(oppCard.xt); if(neg && neg.toLowerCase()===a) myDmg=0; }

  myDmg = Math.max(0, Math.round(myDmg));
  oppDmg = Math.max(0, Math.round(oppDmg));

  const iCanSteal = activeGrantsFirstStrike(myCard, a) || mySupportTags.some(t=>t.type==='firstStrike');
  const oppCanSteal = activeGrantsFirstStrike(oppCard, b) || oppSupportTags.some(t=>t.type==='firstStrike');
  let myGoesFirst;
  if(iAmTurnPlayer===undefined || iAmTurnPlayer===null){
    myGoesFirst = iCanSteal && !oppCanSteal ? true : (!iCanSteal && oppCanSteal ? false : null);
  } else if(iAmTurnPlayer){
    myGoesFirst = !oppCanSteal;
  } else {
    myGoesFirst = iCanSteal;
  }

  if(myGoesFirst===true){
    if(myDmg>=oppHp) oppDmg=0;
  } else if(myGoesFirst===false){
    if(oppDmg>=myHp) myDmg=0;
  }

  if(hiddenBuffer) oppDmg += hiddenBuffer;

  // HP-modifying effects (healing, halving) -- these change actual HP totals,
  // separate from the damage swing used for solver ranking. The resolver
  // applies these to real HP; ranking/matrix code can ignore them if it wants
  // pure damage-swing comparisons.
  let myHealAmt = 0, oppHealAmt = 0, myHalve = false, oppHalve = false;
  mySupportTags.forEach(tag=>{
    if(tag.type==='healSelf') myHealAmt += tag.amount;
    if(tag.type==='healOpp') oppHealAmt += tag.amount;
    if(tag.type==='halveSelfHp') myHalve = true;
    if(tag.type==='halveOppHp') oppHalve = true;
  });
  oppSupportTags.forEach(tag=>{
    if(tag.type==='healSelf') oppHealAmt += tag.amount;
    if(tag.type==='healOpp') myHealAmt += tag.amount;
    if(tag.type==='halveSelfHp') oppHalve = true;
    if(tag.type==='halveOppHp') myHalve = true;
  });

  return { myDmg, oppDmg, koOpp: myDmg>=oppHp, koMe: oppDmg>=myHp, myHealAmt, oppHealAmt, myHalve, oppHalve };
}

function computeMatrix(myCard, oppCard, myHp, oppHp, mySupportTags, hiddenBuffer, iAmTurnPlayer){
  const atks=['o','t','x'];
  const grid = {};
  atks.forEach(a=>{ grid[a]={}; atks.forEach(b=>{
    grid[a][b] = computeCell(myCard, oppCard, myHp, oppHp, a, b, mySupportTags, [], hiddenBuffer, iAmTurnPlayer);
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

function rankSupportOptions(myCard, oppCard, myHp, oppHp, fixedA, hand, oppSupportTagsKnown, hiddenBuffer, iAmTurnPlayer){
  const candidates = [{id:'', name:'— none —', tags:[]}].concat(
    hand.map(c=>({id:String(c._uid||c.id), name:c.name + (c.type==='option'?' (option)':''), tags:parseEffectTags(effectText(c))}))
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

function adjustForEntrance(card){
  if(card.lvl==='C' || card.lvl==='U'){
    return Object.assign({}, card, {
      hp:halveToNearestTen(card.hp), o:halveToNearestTen(card.o), t:halveToNearestTen(card.t), x:halveToNearestTen(card.x), _halved:true
    });
  }
  return Object.assign({}, card, {_halved:false});
}

function effectQualityNote(card){
  let score = 0; const notes = [];
  const xt = (card.xt||'').trim();
  if(parseNegateTag(xt)){ score+=150; notes.push(`Cross negates the opponent's ${parseNegateTag(xt)} entirely.`); }
  else if(isFirstStrikeXTag(xt)){ score+=100; notes.push('Cross grants first-attack priority (valuable if you end up as the non-turn player).'); }
  else if(parseFoeMultiplier(xt)){ const fm=parseFoeMultiplier(xt); score+=50; notes.push(`Cross triples damage vs ${fm.spec} opponents (situational).`); }
  else if(/counter/i.test(xt)){ score+=25; notes.push(`Cross has an order-changing "${xt}" effect (not fully modeled — verify manually).`); }
  else if(xt && xt.toLowerCase()!=='none'){ notes.push(`Cross effect: "${xt}" (situational, not auto-scored).`); }

  const txt = effectText(card);
  const supTags = parseEffectTags(txt);
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

function rankSupportOptionsOpenInfo(myCard, oppCard, myHp, oppHp, fixedA, myHand, oppHandCards, iAmTurnPlayer){
  const myCandidates = [{id:'', name:'— none —', tags:[]}].concat(
    myHand.map(c=>({id:String(c._uid||c.id), name:c.name + (c.type==='option'?' (option)':''), tags:parseEffectTags(effectText(c))}))
  );
  const oppSupportCandidates = [[]].concat(
    (oppHandCards||[]).map(c=>parseEffectTags(effectText(c)))
  );
  return myCandidates.map(cand=>{
    let worst = Infinity;
    ['o','t','x'].forEach(b=>{
      oppSupportCandidates.forEach(oppTags=>{
        const cell = computeCell(myCard, oppCard, myHp, oppHp, fixedA, b, cand.tags, oppTags, 0, iAmTurnPlayer);
        const net = cell.myDmg - cell.oppDmg;
        if(net<worst) worst = net;
      });
    });
    return { id:cand.id, name:cand.name, worst };
  }).sort((x,y)=>y.worst-x.worst);
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
  phase:'kickoff',
  atkStep:'pick',
  myLockedAtk:null,
  mySupportChoiceId:'',
  oppSupportRevealed:null,
  log:[],
};

function logEvent(text){ B.log.unshift({round:B.round, text}); renderLog(); }

function newDuel(){
  Object.assign(B, {
    myScore:0, oppScore:0, round:1, turnPlayer:'me',
    myActive:null, oppActive:null, myHp:0, oppHp:0,
    myDpTotal:0, oppDpTotal:0, myHand:[], oppHand:[], phase:'kickoff',
    atkStep:'pick', myLockedAtk:null, mySupportChoiceId:'', oppSupportRevealed:null,
    log:[]
  });
  renderAll();
}

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
  renderAll();
}

function hpBar(cur, max){
  const pct = max>0 ? Math.max(0,Math.min(100, Math.round(cur/max*100))) : 0;
  return `<div class="hp-bar"><div class="hp-bar-fill" style="width:${pct}%"></div></div>`;
}
function cardMiniPreview(card, hp){
  if(!card) return `<div class="small-note">Not chosen yet.</div>`;
  return `
    <div class="card-preview">
      <div class="name">${card.name} <span class="badge ${specClass(card.sp)}">${card.sp}</span> <span class="badge" style="border-color:#333;color:#9db">${card.lvl}</span></div>
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
  el.innerHTML = `
    <div class="row">
      <div class="col"><label>YOUR ACTIVE</label>${cardMiniPreview(B.myActive, B.myHp)}</div>
      <div class="col"><label>OPPONENT'S ACTIVE</label>${cardMiniPreview(B.oppActive, B.oppHp)}</div>
    </div>
    <div class="row">
      <div class="col">
        <label>YOUR HAND (add cards as you draw them — duplicates are fine, e.g. two Agumon)</label>
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
  wireSearchBox('handSearch', {}, (card)=>{
    if(B.myHand.length>=4){ alert('Hand is already at 4 cards.'); return; }
    B.myHand.push(withUid(card));
    renderStatePanel();
    renderPhase();
  });
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
    list.innerHTML = results.map(c=>`<div class="suggest-item" data-id="${c.id}"><span class="tname">${c.name}</span><span class="ttype">${c.type==='option'?'OPTION CARD':(c.sp+' · '+c.lvl)}</span></div>`).join('') || '<div class="suggest-item">No matches</div>';
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
    (adjusted._halved ? '<div class="warn-box">Entered directly as '+card.lvl+' — HP and all attacks halved from base.</div>' : '');
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
            <b>${r.card.name}</b>${r.card._halved?' (halved on entry)':''} — HP ${r.card.hp}, avg attack ${r.avgAtk}
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
function bankingBonus(currentDp, ppGained){
  if(ppGained<=0) return 0;
  const benchmark = 30;
  if(currentDp >= benchmark) return Math.round(ppGained*0.3);
  const remaining = benchmark - currentDp;
  const effective = Math.min(ppGained, remaining);
  const overflow = Math.max(0, ppGained-remaining);
  return Math.round(effective*1.2 + overflow*0.3);
}

function rankSacrificeOptions(myActive, myDpTotal, hand){
  const digimonCandidates = hand.filter(c=>c.type==='digimon');
  const results = [];
  const baselineEvo = myActive ? digivolveOptions(myActive, myDpTotal, hand) : [];
  results.push({
    id:'', name:'— sacrifice nothing —',
    note: baselineEvo.length ? `You already have ${baselineEvo.length} eligible digivolve target(s) at your current ${myDpTotal} DP.` : `No eligible digivolve targets yet at your current ${myDpTotal} DP.`,
    score: 0
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
      const bonus = bankingBonus(myDpTotal, card.pp||0);
      if(bonus>0){
        score += bonus;
        note += ` No immediate target, but banks progress toward a future digivolve (+${bonus} banking value).`;
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
  const evoOptions = (isMe && active) ? digivolveOptions(active, dpTotal, B.myHand) : [];
  const sacRanked = (isMe && active) ? rankSacrificeOptions(active, dpTotal, B.myHand) : [];
  const oppEvoPreview = (!isMe && active) ? digivolveOptions(active, dpTotal, B.oppHand) : [];
  const speedCard = (isMe && active) ? findSpeedDigivolveCard(B.myHand) : null;
  const speedOptions = speedCard ? speedDigivolveOptions(active, B.myHand.filter(c=>c._uid!==speedCard._uid)) : [];

  el.innerHTML = `
    <h2>▸ DP PHASE (${isMe?'YOUR':"OPPONENT'S"} TURN)</h2>
    <div class="small-note">Sacrificing for DP and digivolving in the same turn are both allowed together.</div>
    ${isMe ? `
      <label>SACRIFICE ADVISOR (ranked by DP gained vs. what you'd give up)</label>
      ${sacRanked.map((r,i)=>`
        <div class="suggestion-rank ${i===0?'top':''}">
          <span>${r.name}<br><span class="small-note">${r.note}</span></span>
          <button class="btn small secondary" onclick="App.doSacrifice('${r.id}')">${r.id?'SACRIFICE':'SKIP'}</button>
        </div>`).join('')}
      <h2 style="margin-top:16px">▸ DIGIVOLVE (current DP: ${dpTotal})</h2>
      ${evoOptions.length ? evoOptions.map(c=>`
        <div class="suggestion-rank">
          <span><b>${c.name}</b> (${c.lvl}, needs ${c.dp} DP) — HP ${c.hp}, O ${c.o}/T ${c.t}/X ${c.x}</span>
          <button class="btn small" onclick="App.doDigivolve('${c._uid}')">DIGIVOLVE</button>
        </div>
      `).join('') : '<div class="small-note">No eligible digivolve targets in hand right now.</div>'}
      ${speedCard ? `
        <h2 style="margin-top:16px">▸ SPEED DIGIVOLVE AVAILABLE (${speedCard.name} in hand — ignores DP cost)</h2>
        ${speedOptions.length ? speedOptions.map(c=>`
          <div class="suggestion-rank">
            <span><b>${c.name}</b> (${c.lvl}, DP cost waived) — HP ${c.hp}, O ${c.o}/T ${c.t}/X ${c.x}</span>
            <button class="btn small" onclick="App.doSpeedDigivolve('${c._uid}')">SPEED DIGIVOLVE</button>
          </div>
        `).join('') : '<div class="small-note">No eligible same-specialty target in hand right now to use it on.</div>'}
      ` : ''}
    ` : `
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
    `}
    <button class="btn" style="margin-top:16px" onclick="App.confirmDpDone()">CONTINUE →</button>
  `;
  if(!isMe){
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
  }
}

function renderAttackPhase(el){
  if(!B.myActive || !B.oppActive){ el.innerHTML = '<div class="small-note">Missing active Digimon on one side — this phase should not be reachable yet.</div>'; return; }
  const iAmTurnPlayer = B.turnPlayer==='me';

  if(B.atkStep==='pick'){
    const grid = computeMatrix(B.myActive, B.oppActive, B.myHp, B.oppHp, [], 0, iAmTurnPlayer);
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
    const oppTags = B.oppSupportRevealed ? parseEffectTags(effectText(B.oppSupportRevealed)) : [];
    const ranked = rankSupportOptions(B.myActive, B.oppActive, B.myHp, B.oppHp, B.myLockedAtk, B.myHand, oppTags, 0, iAmTurnPlayer);
    el.innerHTML = `
      <h2>▸ YOUR SUPPORT (REACTING)</h2>
      <div class="small-note">You locked ${B.myLockedAtk.toUpperCase()}. Opponent's support: <b>${B.oppSupportRevealed?B.oppSupportRevealed.name:'none'}</b>. Ranked by worst-case outcome against their 3 possible attacks:</div>
      ${ranked.map((r,i)=>`
        <div class="suggestion-rank ${i===0?'top':''}">
          <span>${r.name}</span>
          <span class="val">${r.worst>=0?'+':''}${r.worst}</span>
          <button class="btn small secondary" onclick="App.pickMySupport('${r.id}')">USE</button>
        </div>`).join('')}
      <div class="suggestion-rank">
        <span>Play a random card from my deck<br><span class="small-note">Unknown effect — can't be scored, this is a genuine gamble.</span></span>
        <button class="btn small secondary" onclick="App.pickMySupport('__random__')">USE</button>
      </div>
    `;
    return;
  }

  if(B.atkStep==='myBlindSupport'){
    const ranked = rankSupportOptionsOpenInfo(B.myActive, B.oppActive, B.myHp, B.oppHp, B.myLockedAtk, B.myHand, B.oppHand, iAmTurnPlayer);
    el.innerHTML = `
      <h2>▸ YOUR SUPPORT (COMMITTING BLIND)</h2>
      <div class="small-note">It's the opponent's turn, so you (non-turn player) must commit support first. You locked ${B.myLockedAtk.toUpperCase()}. Since their hand is visible, this is the true worst case across all 3 of their attacks and every support card actually in their hand (${B.oppHand.length} tracked) — not a guess.</div>
      <div id="rankedSupportList">
        ${ranked.map((r,i)=>`
          <div class="suggestion-rank ${i===0?'top':''}">
            <span>${r.name}</span>
            <span class="val">${r.worst>=0?'+':''}${r.worst}</span>
            <button class="btn small secondary" onclick="App.pickMySupport('${r.id}')">USE</button>
          </div>`).join('')}
        <div class="suggestion-rank">
          <span>Play a random card from my deck<br><span class="small-note">Unknown effect — can't be scored, this is a genuine gamble.</span></span>
          <button class="btn small secondary" onclick="App.pickMySupport('__random__')">USE</button>
        </div>
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
  el.innerHTML = B.log.map(e=>`<div class="log-entry"><span class="tag">R${e.round}</span>${e.text}</div>`).join('') || '<div class="small-note">No events yet.</div>';
}

function renderAll(){ renderHeader(); renderStatePanel(); renderPhase(); renderLog(); }

const App = {
  newDuel(){ if(confirm('Reset the whole duel (score, hand, DP totals)?')) newDuel(); },

  confirmDraw(){
    B.phase = activeFor(B.turnPlayer) ? 'dp' : 'entrance';
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
      logEvent(`You enter with ${picked.adjusted.name}${(picked.raw.lvl==='C'||picked.raw.lvl==='U')?' (halved on entry)':''}.`);
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
    if(!id){ logEvent('You chose not to sacrifice this turn.'); renderDpPhase(document.getElementById('phasePanel')); return; }
    const card = findInHand(B.myHand, id);
    if(!card) return;
    B.myDpTotal += (card.pp||0);
    removeFromHand(card._uid||card.id);
    logEvent(`You sacrificed ${card.name} for +${card.pp||0} DP (total ${B.myDpTotal}).`);
    renderDpPhase(document.getElementById('phasePanel'));
    renderStatePanel(); renderHeader();
  },

  doOppSacrifice(){
    const selectId = document.getElementById('oppSacSelect').value;
    if(selectId){
      const card = findInHand(B.oppHand, selectId);
      if(card){
        B.oppDpTotal += (card.pp||0);
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
    if(nameVal){ const oc = findCardByName(nameVal); if(oc) gain = oc.pp||0; removeFromOppHand(oc ? oc.id : ''); }
    if(gain>0 || nameVal){
      B.oppDpTotal += gain;
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
    const mySupportTags = mySupportCard ? parseEffectTags(effectText(mySupportCard)) : (myRandomReveal ? parseEffectTags(effectText(myRandomReveal)) : []);

    const oppWasRandom = B.oppSupportRevealed && B.oppSupportRevealed.type==='unknown';
    const oppRandomReveal = oppWasRandom ? App._oppRandomRevealCard : null;
    const oppSupportTags = (B.oppSupportRevealed && !oppWasRandom) ? parseEffectTags(effectText(B.oppSupportRevealed)) : (oppRandomReveal ? parseEffectTags(effectText(oppRandomReveal)) : []);

    let unknownNote = '';
    if(oppAtk==='__unknown__'){
      const options = ['o','t','x'].map(b=>computeCell(B.myActive, B.oppActive, B.myHp, B.oppHp, B.myLockedAtk, b, mySupportTags, oppSupportTags, 0, iAmTurnPlayer));
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

    const cell = computeCell(B.myActive, B.oppActive, B.myHp, B.oppHp, B.myLockedAtk, oppAtk, mySupportTags, oppSupportTags, 0, iAmTurnPlayer);
    B.oppHp = Math.max(0, B.oppHp - cell.myDmg);
    B.myHp = Math.max(0, B.myHp - cell.oppDmg);
    // HP-modifying effects (heals are typically confirmed permanent; applied after the damage exchange).
    if(cell.myHalve) B.myHp = Math.floor(B.myHp/2);
    if(cell.oppHalve) B.oppHp = Math.floor(B.oppHp/2);
    if(cell.myHealAmt) B.myHp += cell.myHealAmt;
    if(cell.oppHealAmt) B.oppHp += cell.oppHealAmt;
    if(mySupportCard) removeFromHand(mySupportCard._uid||mySupportCard.id);

    const mySupportLabel = mySupportCard ? ' + '+mySupportCard.name : (myRandomReveal ? ' + random card (revealed: '+myRandomReveal.name+')' : (B.mySupportChoiceId==='__random__' ? ' + random card (unknown effect)' : ''));
    const oppSupportLabel = B.oppSupportRevealed ? ' + '+(oppRandomReveal ? 'random card (revealed: '+oppRandomReveal.name+')' : B.oppSupportRevealed.name+(oppWasRandom?' (unknown effect)':'')) : '';
    let hpEffectNote = '';
    if(cell.myHealAmt || cell.oppHealAmt || cell.myHalve || cell.oppHalve){
      const parts = [];
      if(cell.myHealAmt) parts.push(`you recovered ${cell.myHealAmt} HP`);
      if(cell.oppHealAmt) parts.push(`opponent recovered ${cell.oppHealAmt} HP`);
      if(cell.myHalve) parts.push(`your HP was halved`);
      if(cell.oppHalve) parts.push(`opponent's HP was halved`);
      hpEffectNote = ' ('+parts.join(', ')+', applied and permanent)';
    }
    logEvent(`You: ${B.myLockedAtk.toUpperCase()} (${cell.myDmg} dmg)${mySupportLabel} vs Opponent: ${oppAtk.toUpperCase()} (${cell.oppDmg} dmg)${oppSupportLabel}${unknownNote}${hpEffectNote}. HP now You ${B.myHp} / Opp ${B.oppHp}.`);
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
      <td>${c.id}</td><td>${c.name}</td><td>${c.lvl}</td>
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
  const specs=["Fire","Water","Nature","Darkness","Rare","Partner"];
  document.getElementById('specFilters').innerHTML = specs.map(s=>`<button class="tag-btn ${dbFilterSpec===s?'active':''}" data-spec="${s}">${s}</button>`).join('') +
    `<button class="tag-btn ${!dbFilterSpec?'active':''}" data-spec="">All</button>`;
  document.querySelectorAll('#specFilters .tag-btn').forEach(b=>b.addEventListener('click', ()=>{ dbFilterSpec=b.dataset.spec||null; renderSpecFilters(); renderDbTable(); }));
}

function openEditForm(id){
  const card = ALL_CARDS.find(c=>String(c.id)===String(id)) || {id:'new_'+Date.now(),type:'digimon',name:'',lvl:'R',sp:'Fire',hp:0,dp:0,pp:0,o:0,t:0,x:0,xt:'none',note:''};
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
      note: document.getElementById('ef-note').value
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

function wireTabs(){
  document.querySelectorAll('nav button').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      document.querySelectorAll('nav button').forEach(b=>b.classList.remove('active'));
      document.querySelectorAll('.tabsection').forEach(s=>s.classList.remove('active'));
      btn.classList.add('active');
      document.getElementById('tab-'+btn.dataset.tab).classList.add('active');
    });
  });
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
