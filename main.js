// Chinese Checkers — strong engine + themes + robust help + difficulty ladder.
// Human = BLUE (bottom). AI = RED (top).

const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d");
const logEl = document.getElementById("log");
const timeSlider = document.getElementById("timeSlider");
const timeLabel = document.getElementById("timeLabel");
const styleSelect = document.getElementById("styleSelect");
const levelSelect = document.getElementById("levelSelect");
const themeSelect = document.getElementById("themeSelect");
const eloLabel = document.getElementById("eloLabel");

const btnMyBest  = document.getElementById("hintMyBest");
const btnBotNext = document.getElementById("hintBotNext");
const btnClear   = document.getElementById("hintClear");

timeSlider?.addEventListener("input", () => timeLabel.textContent = (timeSlider.value/1000).toFixed(1)+"s");

// ---------------- Difficulty presets ----------------
const LEVELS = {
  1: { name:"Beginner",     elo:800,  timeScale:0.45, maxDepth:10, qdepth:2, lmrExtra:1, futilityFactor:1.6, topK:3, pBest:0.55 },
  2: { name:"Casual",       elo:1100, timeScale:0.75, maxDepth:14, qdepth:3, lmrExtra:1, futilityFactor:1.3, topK:2, pBest:0.75 },
  3: { name:"Intermediate", elo:1400, timeScale:1.00, maxDepth:20, qdepth:4, lmrExtra:0, futilityFactor:1.0, topK:1, pBest:1.00 },
  4: { name:"Advanced",     elo:1700, timeScale:1.50, maxDepth:24, qdepth:4, lmrExtra:0, futilityFactor:1.0, topK:1, pBest:1.00 },
  5: { name:"Master",       elo:2000, timeScale:2.20, maxDepth:28, qdepth:4, lmrExtra:0, futilityFactor:1.0, topK:1, pBest:1.00 },
};
function updateEloBadge(){
  const L = LEVELS[STATE.settings.level] || LEVELS[3];
  if (eloLabel) eloLabel.textContent = `≈ ${L.elo}`;
}
levelSelect?.addEventListener("change", ()=>{
  STATE.settings.level = parseInt(levelSelect.value,10) || 3;
  updateEloBadge();
});

// ---------------- Geometry ----------------
const DIRS = [[1,-1,0],[1,0,-1],[0,1,-1],[-1,1,0],[-1,0,1],[0,-1,1]];
const key = (x,y,z)=>`${x},${y},${z}`;

function generateBoard(){
  const cells = new Map();
  const push = (x,y,z)=>{ cells.set(key(x,y,z), {x,y,z}) };
  const R=4;
  for(let x=-R;x<=R;x++){
    for(let y=-R;y<=R;y++){
      const z=-x-y;
      if(Math.max(Math.abs(x),Math.abs(y),Math.abs(z))<=R) push(x,y,z);
    }
  }
  for(let s=5;s<=8;s++){
    for(let y=-4; y<=4-s; y++){ let x=s,   z=-x-y; push(x,y,z); }
    for(let y=s-4; y<=4;   y++){ let x=-s,  z=-x-y; push(x,y,z); }
    for(let x=-4; x<=4-s; x++){ let y=s,   z=-x-y; push(x,y,z); }
    for(let x=s-4; x<=4;   x++){ let y=-s,  z=-x-y; push(x,y,z); }
    for(let x=-4; x<=4-s; x++){ let z=s,   y=-x-z; push(x,y,z); }
    for(let x=s-4; x<=4;   x++){ let z=-s,  y=-x-z; push(x,y,z); }
  }
  const arr = Array.from(cells.values());
  arr.sort((a,b)=> a.z-b.z || a.y-b.y || a.x-b.x);
  arr.forEach((c,i)=> c.idx=i);

  const map = new Map(arr.map(c=>[key(c.x,c.y,c.z), c]));
  for(const c of arr){
    c.nei=[];
    for(const d of DIRS){
      const nb = map.get(key(c.x+d[0],c.y+d[1],c.z+d[2]));
      if(nb) c.nei.push(nb.idx);
    }
  }
  const SOUTH = arr.filter(c=>c.z>=5).map(c=>c.idx);
  const NORTH = arr.filter(c=>c.z<=-5).map(c=>c.idx);
  return {cells:arr, map, SOUTH, NORTH};
}
const BOARD = generateBoard();

function axialToPixel(x,z, s){ return [s*(Math.sqrt(3)*(x + z/2)), s*(1.5*z)]; }
const BASE = (()=>{ let minX=1e9,maxX=-1e9,minY=1e9,maxY=-1e9;
  for(const c of BOARD.cells){ const [x,y]=axialToPixel(c.x,c.z,1);
    if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y; }
  return {minX,maxX,minY,maxY};
})();

// ---------------- State ----------------
const STATE = {
  board: new Uint8Array(BOARD.cells.length),
  turn: 1,
  selected: null,
  legal: [],
  lastMove: null,
  history: [],
  settings: {
    botMs: parseInt(timeSlider?.value||"1800",10),
    style: styleSelect?.value || "solid",     // search profile
    level: parseInt(levelSelect?.value||"3",10),
    theme: themeSelect?.value || "dark"       // new: visual theme
  },
  layout: { scale:1, shiftX:0, shiftY:0, pickR2:225, pegR:12, holeR:10 },
  hints: { me: null, bot: null },
  hintBusy: { me:false, bot:false }
};
updateEloBadge();

styleSelect?.addEventListener("change",()=>{ STATE.settings.style = styleSelect.value; draw(); });
timeSlider?.addEventListener("change",()=> STATE.settings.botMs = parseInt(timeSlider.value,10));
themeSelect?.addEventListener("change",()=>{ STATE.settings.theme = themeSelect.value; draw(); });

// ---------------- Setup ----------------
function setupNewGame(){
  STATE.board.fill(0);
  for(const i of BOARD.SOUTH) STATE.board[i]=1;
  for(const i of BOARD.NORTH) STATE.board[i]=2;
  STATE.turn=1; STATE.selected=null; STATE.legal=[];
  STATE.lastMove=null; STATE.history=[];
  STATE.hints.me=null; STATE.hints.bot=null;
  logEl && (logEl.innerHTML="");
  const L = LEVELS[STATE.settings.level];
  log(`New game. Difficulty: <b>${L.name}</b> (≈${L.elo}). You're blue at the bottom; your move.`, "human");
  draw();
}

// ---------------- Layout / Draw ----------------
function resizeCanvas(){
  if(!canvas) return;
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(rect.width*dpr);
  canvas.height = Math.floor(rect.height*dpr);
  ctx.setTransform(dpr,0,0,dpr,0,0);
  computeLayout(); draw();
}
window.addEventListener("resize", resizeCanvas);

function computeLayout(){
  const W=canvas.clientWidth, H=canvas.clientHeight, m=26;
  const baseW = BASE.maxX-BASE.minX, baseH = BASE.maxY-BASE.minY;
  const s = Math.min((W-2*m)/baseW, (H-2*m)/baseH);
  STATE.layout.scale=s;
  STATE.layout.shiftX = (W - s*baseW)/2 - s*BASE.minX;
  STATE.layout.shiftY = (H - s*baseH)/2 - s*BASE.minY;
  STATE.layout.pickR2 = Math.max(120, Math.pow(10 + s*0.6,2));
  const pegR = Math.max(10, 0.38*s+8);
  STATE.layout.pegR = pegR;
  STATE.layout.holeR = pegR-2;
}
function P(c){ const s=STATE.layout.scale, sx=STATE.layout.shiftX, sy=STATE.layout.shiftY; const [x,y]=axialToPixel(c.x,c.z,s); return [x+sx,y+sy]; }
function pixelBounds(){
  let minX=1e9,maxX=-1e9,minY=1e9,maxY=-1e9;
  for(const c of BOARD.cells){ const [x,y]=P(c); if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y; }
  return {minX,maxX,minY,maxY, cx:(minX+maxX)/2, cy:(minY+maxY)/2};
}

// ---------------- Logging ----------------
function log(msg, cls=""){ if(!logEl) return; const el=document.createElement("div"); el.className="line "+cls; el.innerHTML=msg; logEl.prepend(el); }
function cloneBoard(b){ return new Uint8Array(b); }
function hasWon(player, b){
  const tri = (player===1? BOARD.NORTH : BOARD.SOUTH);
  for(const idx of tri) if(b[idx]!==player) return false;
  return true;
}
function coordString(idx){ const c=BOARD.cells[idx]; return `[${c.x},${c.y},${c.z}]`; }

// ---------------- Moves / Legality ----------------
function stepMovesFromIdx(board, idx){
  const res=[], c=BOARD.cells[idx];
  for(const nbIdx of c.nei) if(board[nbIdx]===0) res.push({from:idx,to:nbIdx,type:"step",path:[idx,nbIdx]});
  return res;
}
function hopMovesFromIdx(board, idx){
  const res=[], visited=new Set([idx]);
  function dfs(cur, path){
    const c=BOARD.cells[cur];
    for(const d of DIRS){
      const over = BOARD.map.get(key(c.x+d[0],c.y+d[1],c.z+d[2]));
      const land = BOARD.map.get(key(c.x+2*d[0],c.y+2*d[1],c.z+2*d[2]));
      if(!over||!land) continue;
      if(board[over.idx]===0) continue;
      if(board[land.idx]!==0) continue;
      if(visited.has(land.idx)) continue;
      visited.add(land.idx);
      dfs(land.idx, path.concat([land.idx]));
      visited.delete(land.idx);
    }
    if(path.length>1) res.push({from:idx,to:cur,type:"hop",path:path.slice()});
  }
  dfs(idx,[idx]);
  const best=new Map();
  for(const m of res){ const b=best.get(m.to); if(!b || m.path.length<b.path.length) best.set(m.to,m); }
  return Array.from(best.values());
}
function legalMovesFor(board, player, idx){
  if(board[idx]!==player) return [];
  return hopMovesFromIdx(board, idx).concat(stepMovesFromIdx(board, idx));
}
function allMoves(board, player){
  const out=[]; for(let i=0;i<board.length;i++) if(board[i]===player){
    const ms = legalMovesFor(board, player, i); for(const m of ms) out.push(m);
  } return out;
}
function isLegalMove(board, player, m){
  if(!m || m.from===undefined || m.to===undefined) return false;
  if(board[m.from]!==player) return false;
  if(board[m.to]!==0) return false;

  if(m.type==="step"){
    const c=BOARD.cells[m.from];
    for(const nbIdx of c.nei) if(nbIdx===m.to) return true;
    return false;
  }
  if(m.type==="hop"){
    if(!m.path || m.path.length<2 || m.path[0]!==m.from || m.path[m.path.length-1]!==m.to) return false;
    const tmp = new Uint8Array(board);
    let cur = m.from;
    for(let i=1;i<m.path.length;i++){
      const nxt = m.path[i];
      const a = BOARD.cells[cur], b = BOARD.cells[nxt];
      const dx=b.x-a.x, dy=b.y-a.y, dz=b.z-a.z;
      let ok=false, overIdx=null;
      for(const d of DIRS){
        if(dx===2*d[0] && dy===2*d[1] && dz===2*d[2]){
          const over = BOARD.map.get(key(a.x+d[0],a.y+d[1],a.z+d[2]));
          if(!over) return false;
          overIdx = over.idx; ok=true; break;
        }
      }
      if(!ok) return false;
      if(tmp[overIdx]===0) return false;
      if(tmp[nxt]!==0) return false;
      tmp[cur]=0; tmp[nxt]=player; cur=nxt;
    }
    return true;
  }
  return false;
}

// ---------------- Interaction ----------------
function pickCell(px,py){
  let best=null, bestd=1e12, r2=STATE.layout.pickR2;
  for(const c of BOARD.cells){
    const [x,y]=P(c);
    const d2=(x-px)*(x-px)+(y-py)*(y-py);
    if(d2<r2 && d2<bestd){ best=c.idx; bestd=d2; }
  }
  return best;
}

// New: chess.com-like deselect — click the same piece again to clear highlights
canvas?.addEventListener("click", (evt)=>{
  const rect = canvas.getBoundingClientRect();
  const hit = pickCell(evt.clientX-rect.left, evt.clientY-rect.top);
  if(hit==null || STATE.turn!==1) return;

  // if something is already selected and user clicks it again -> deselect
  if(STATE.selected!=null && hit===STATE.selected){
    STATE.selected=null; STATE.legal=[]; draw();
    return;
  }

  if(STATE.selected==null){
    if(STATE.board[hit]===1){
      STATE.selected=hit;
      STATE.legal=legalMovesFor(STATE.board,1,hit);
    }
  }else{
    const m = STATE.legal.find(mm=>mm.to===hit);
    if(m && isLegalMove(STATE.board,1,m)){
      applyMove(m,true);
      if(hasWon(1, STATE.board)){ log("<span class='badge'>You win 🎉</span>","human"); STATE.turn=0; draw(); return; }
      setTimeout(aiTurn, 20);
    }else if(STATE.board[hit]===1){
      // switch selection to a different own piece
      STATE.selected=hit;
      STATE.legal=legalMovesFor(STATE.board,1,hit);
    }else{
      // clicked elsewhere (empty or opponent) -> just clear instead of logging noise
      STATE.selected=null; STATE.legal=[]; 
    }
  }
  draw();
});

// Optional: quick keyboard “escape” to clear highlights
document.addEventListener("keydown", (e)=>{
  if(e.key==="Escape"){
    STATE.selected=null; STATE.legal=[]; draw();
  }
});

document.getElementById("newGame")?.addEventListener("click",()=>setupNewGame());
document.getElementById("undoBtn")?.addEventListener("click",()=>{
  if(STATE.history.length>=2){
    STATE.history.pop();
    const snap = STATE.history.pop();
    STATE.board=snap.board; STATE.turn=snap.turn; STATE.lastMove=snap.last;
    STATE.selected=null; STATE.legal=[];
    STATE.hints.me=null; STATE.hints.bot=null;
    log("Undid last turn.",""); draw();
  }
});

// ---------------- Engine (same core, plus difficulty knobs) ----------------
const ZO = (()=>{ const rnd=()=> (Math.random()*2**32)|0;
  const t1=new Uint32Array(BOARD.cells.length), t2=new Uint32Array(BOARD.cells.length);
  for(let i=0;i<BOARD.cells.length;i++){ t1[i]=rnd(); t2[i]=rnd(); }
  return {t:[t1,t2]};
})();
function zobrist(board){ let h=0|0; for(let i=0;i<board.length;i++){ const v=board[i]; if(v===1) h^=ZO.t[0][i]; else if(v===2) h^=ZO.t[1][i]; } return h>>>0; }
const TT=new Map(); const EXACT=0,LOWER=1,UPPER=2;

function dist(a,b){ return (Math.abs(a.x-b.x)+Math.abs(a.y-b.y)+Math.abs(a.z-b.z))/2; }
const GOAL = { 1: BOARD.NORTH.map(i=>BOARD.cells[i]), 2: BOARD.SOUTH.map(i=>BOARD.cells[i]) };
const HOME = { 1: BOARD.SOUTH, 2: BOARD.NORTH };
const goalIdx = { 1: new Set(GOAL[1].map(c=>c.idx)), 2: new Set(GOAL[2].map(c=>c.idx)) };
const centerDist = BOARD.cells.map(c => Math.max(Math.abs(c.x),Math.abs(c.y),Math.abs(c.z)));
const N = BOARD.cells.length;
const minDistToGoal = { 1:new Int8Array(N), 2:new Int8Array(N) };
(function(){
  for(let i=0;i<N;i++){
    const c = BOARD.cells[i];
    let d1=99,d2=99;
    for(const g of GOAL[1]) d1=Math.min(d1, dist(c,g));
    for(const g of GOAL[2]) d2=Math.min(d2, dist(c,g));
    minDistToGoal[1][i]=d1; minDistToGoal[2][i]=d2;
  }
})();
function evalBoardFull(board){
  let distSum1=0, distSum2=0, spread1=0, spread2=0, home1=0, home2=0, goal1=0, goal2=0;
  const home1set=new Set(HOME[1]), home2set=new Set(HOME[2]);
  for(let i=0;i<board.length;i++){
    const p=board[i]; if(!p) continue;
    if(p===1){
      distSum1 += minDistToGoal[1][i];
      spread1  += centerDist[i];
      if(home1set.has(i)) home1++;
      if(goalIdx[1].has(i)) goal1++;
    }else{
      distSum2 += minDistToGoal[2][i];
      spread2  += centerDist[i];
      if(home2set.has(i)) home2++;
      if(goalIdx[2].has(i)) goal2++;
    }
  }
  const wD=90, wSpread=6, wHome=12, wGoal=50;
  return (distSum2-distSum1)*wD + (spread2-spread1)*wSpread + (home2-home1)*wHome + (goal1-goal2)*wGoal;
}
function evalBoardFor(board, player){ const s=evalBoardFull(board); return (player===1? s : -s); }

// killers/history
const MAX_PLY = 64;
let killers, history;
function resetHeuristics(){
  killers = Array.from({length:MAX_PLY}, ()=>[null,null]);
  history = new Int32Array(N*N);
}
const histIndex = (from,to)=> from*N + to;

// Search config (set per call)
let SEARCH_CFG = { qdepth:4, futilityFactor:1.0, lmrExtra:0 };
function moveHeuristic(board, player, m, isRoot, prevMove){
  const wHop=100000, wProg=1200, wCenter=5, wBack=-500, wHomeEnd=-200, wLeaveGoal=-2000;
  const progFrom = minDistToGoal[player][m.from];
  const progTo   = minDistToGoal[player][m.to];
  let score = (m.type==="hop"? wHop:0) + wProg*(progFrom-progTo) - (centerDist[m.to]*wCenter);
  if(isRoot && prevMove && prevMove.from===m.to && prevMove.to===m.from) score += wBack;
  if((player===1 && HOME[1].includes(m.to)) || (player===2 && HOME[2].includes(m.to))) score += wHomeEnd;
  if(goalIdx[player].has(m.from) && !goalIdx[player].has(m.to)) score += wLeaveGoal;
  return score;
}
function generateOrderedMoves(board, player, ttBestMove, isRoot, prevMove, ply){
  const arr=[];
  for(let i=0;i<board.length;i++) if(board[i]===player){
    const hops=hopMovesFromIdx(board,i), steps=stepMovesFromIdx(board,i);
    for(const m of hops.concat(steps)){
      if(!m.path) m.path=(m.type==="step"? [m.from,m.to] : m.path);
      let s = moveHeuristic(board,player,m,isRoot,prevMove);
      if(ttBestMove && m.from===ttBestMove.from && m.to===ttBestMove.to) s += 1e9;
      const k = killers?.[ply];
      if(k){ if(k[0] && k[0].from===m.from && k[0].to===m.to) s += 5e8; else if(k[1] && k[1].from===m.from && k[1].to===m.to) s += 5e8 - 1; }
      if(history) s += (history[histIndex(m.from,m.to)]|0);
      m.score=s; arr.push(m);
    }
  }
  arr.sort((a,b)=>b.score-a.score);
  return arr;
}
function applyMoveBoardTmp(board,m){ const who=board[m.from]; board[m.from]=0; board[m.to]=who; }

function qsearch(board, player, alpha, beta, ply, deadline){
  if(performance.now()>deadline) return alpha;
  const stand = evalBoardFor(board, player);
  if(stand >= beta) return stand;
  if(stand > alpha) alpha = stand;
  if(SEARCH_CFG.qdepth<=0) return alpha;

  const hops=[];
  for(let i=0;i<board.length;i++) if(board[i]===player){
    const hs=hopMovesFromIdx(board,i);
    for(const m of hs){ m.path=m.path||[m.from,m.to]; m.score=moveHeuristic(board,player,m,false,null); hops.push(m); }
  }
  if(hops.length===0) return alpha;
  hops.sort((a,b)=>b.score-a.score);

  const nextDepth = SEARCH_CFG.qdepth-1;
  for(const m of hops){
    if(!isLegalMove(board,player,m)) continue;
    const f=board[m.from], t=board[m.to];
    applyMoveBoardTmp(board,m);
    const saved = SEARCH_CFG.qdepth; SEARCH_CFG.qdepth = nextDepth;
    const sc = -qsearch(board,3-player,-beta,-alpha,ply+1,deadline);
    SEARCH_CFG.qdepth = saved;
    board[m.to]=t; board[m.from]=f;
    if(performance.now()>deadline) break;
    if(sc>=beta) return sc;
    if(sc>alpha) alpha=sc;
  }
  return alpha;
}

function negamax(board, player, depth, alpha, beta, ply, deadline, isRoot=false, prevMove=null){
  if(performance.now()>deadline) return {score:0, move:null};
  if(depth===0){
    const qs=qsearch(board,player,alpha,beta,ply,deadline);
    return {score:qs, move:null};
  }

  const origAlpha=alpha, origBeta=beta;
  const h=(zobrist(board) ^ (player===2? 0x9e3779b9:0))>>>0;
  const e=TT.get(h); let ttMove=null;
  if(e && e.depth>=depth){
    if(e.flag===EXACT) return {score:e.score, move:e.best};
    else if(e.flag===LOWER) alpha=Math.max(alpha,e.score);
    else if(e.flag===UPPER) beta=Math.min(beta,e.score);
    ttMove=e.best; if(alpha>=beta) return {score:e.score, move:e.best};
  }

  const staticEval = evalBoardFor(board, player);
  const moves = generateOrderedMoves(board, player, ttMove, isRoot, prevMove, ply);
  if(moves.length===0) return {score: staticEval, move:null};

  let bestScore=-1e9, best=null;
  let first=true, mIndex=0;

  for(const m of moves){
    if(!isLegalMove(board, player, m)) { mIndex++; continue; }

    if(depth<=2 && m.type==="step" && !isRoot){
      const margin = 600*depth*SEARCH_CFG.futilityFactor;
      if(staticEval + margin <= alpha){ mIndex++; continue; }
    }

    const f=board[m.from], t=board[m.to];
    applyMoveBoardTmp(board,m);
    if(hasWon(player, board)){
      const s = 1e6 - (100*ply);
      board[m.to]=t; board[m.from]=f;
      TT.set(h,{depth,score:s,flag:EXACT,best:m});
      return {score:s, move:m};
    }

    const isQuiet=(m.type==="step");
    let newDepth=depth-1, reduction=0;
    if(newDepth>=2 && isQuiet && mIndex>=3 && !isRoot){
      reduction = 1 + (SEARCH_CFG.lmrExtra|0);
    }

    let sc;
    if(first){
      const child=negamax(board,3-player,newDepth-reduction,-beta,-alpha,ply+1,deadline,false,null);
      sc=-child.score;
    }else{
      let child=negamax(board,3-player,newDepth-reduction,-alpha-1,-alpha,ply+1,deadline,false,null);
      sc=-child.score;
      if(sc>alpha){
        child=negamax(board,3-player,newDepth,-beta,-alpha,ply+1,deadline,false,null);
        sc=-child.score;
      }
    }

    board[m.to]=t; board[m.from]=f;
    if(performance.now()>deadline) break;

    if(sc>bestScore){ bestScore=sc; best=m; }
    if(sc>alpha) alpha=sc;

    if(alpha>=beta){
      if(isQuiet){
        const k=killers[ply];
        if(!k[0] || k[0].from!==m.from || k[0].to!==m.to){ k[1]=k[0]; k[0]={from:m.from,to:m.to}; }
        history[histIndex(m.from,m.to)] += (depth*depth + 2);
      }
      break;
    }
    first=false; mIndex++;
  }

  let flag=EXACT;
  if(bestScore<=origAlpha) flag=UPPER; else if(bestScore>=origBeta) flag=LOWER;
  TT.set(h,{depth,score:bestScore,flag,best});
  return {score:bestScore, move:best};
}

// style cap helper
function styleDepthCap(style){
  if(style==="greedy") return 10;
  if(style==="deep") return 28;
  return 24; // solid/default
}

function searchRoot(board, player, timeMs, style, prevMove, levelCfg){
  const start=performance.now(), deadline=start+timeMs;
  resetHeuristics(); TT.clear();

  // bind difficulty controls
  SEARCH_CFG.qdepth = levelCfg.qdepth;
  SEARCH_CFG.futilityFactor = levelCfg.futilityFactor;
  SEARCH_CFG.lmrExtra = levelCfg.lmrExtra;

  let bestMove=null, bestScore=-1e9;
  let MAXDEPTH = Math.min(styleDepthCap(style||"solid"), levelCfg.maxDepth);

  let prevScore=0;
  for(let depth=2; depth<=MAXDEPTH; depth++){
    let window=1500, alpha=(depth>2? prevScore-window : -1e9), beta=(depth>2? prevScore+window : 1e9), attempt=0;
    while(true){
      const {score, move}=negamax(board, player, depth, alpha, beta, 0, deadline, true, prevMove);
      if(performance.now()>deadline) return {bestMove, score:bestScore};
      if(score<=alpha){ attempt++; alpha-=window*2; window*=2; if(attempt>2){ alpha=-1e9; } continue; }
      else if(score>=beta){ attempt++; beta+=window*2; window*=2; if(attempt>2){ beta=1e9; } continue; }
      else{ if(move){ bestMove=move; bestScore=score; prevScore=score; } break; }
    }
    if(performance.now()>deadline) break;
  }
  return {bestMove, score:bestScore};
}

// Select a move at a given level (adds top-K sampling on easy levels)
function timeForLevel(baseMs, levelCfg){
  return Math.max(300, Math.min(6000, Math.round(baseMs * levelCfg.timeScale)));
}
function chooseFromTopK(board, player, bestMove, k){
  resetHeuristics();
  const ordered = generateOrderedMoves(board, player, null, true, STATE.lastMove, 0);
  const cand=[];
  for(const m of ordered){
    if(isLegalMove(board,player,m)) cand.push(m);
    if(cand.length>=k) break;
  }
  if(cand.length===0) return bestMove || null;
  if(bestMove && !cand.some(m=>m.from===bestMove.from && m.to===bestMove.to)) cand.unshift(bestMove);
  return cand[Math.min(cand.length-1, Math.floor(Math.random()*k))];
}

async function selectMoveForLevel(player){
  const L = LEVELS[STATE.settings.level] || LEVELS[3];
  const ms = timeForLevel(STATE.settings.botMs, L);
  const {bestMove} = searchRoot(cloneBoard(STATE.board), player, ms, STATE.settings.style, STATE.lastMove, L);
  if(!bestMove) return null;

  if(L.topK>1){
    if(Math.random() >= L.pBest){
      const alt = chooseFromTopK(STATE.board, player, bestMove, L.topK);
      if(alt && isLegalMove(STATE.board, player, alt)) return alt;
    }
  }
  return bestMove;
}

// ---------------- Bot / Hints ----------------
async function aiTurn(){
  if(STATE.turn!==2) return;
  STATE.hints.bot=null; draw();

  let best = await selectMoveForLevel(2);
  if(!best || !isLegalMove(STATE.board,2,best)){
    const quick = { ...LEVELS[STATE.settings.level] };
    quick.timeScale = Math.min(1.0, quick.timeScale);
    const {bestMove} = searchRoot(cloneBoard(STATE.board), 2, timeForLevel(800, quick), STATE.settings.style, STATE.lastMove, quick);
    best = bestMove;
    if(!best || !isLegalMove(STATE.board,2,best)){
      const moves = allMoves(STATE.board,2);
      best = moves.find(m=>isLegalMove(STATE.board,2,m)) || null;
    }
  }
  if(best){
    applyMove(best,false);
    draw();
    if(hasWon(2, STATE.board)){ log("<span class='badge'>Bot wins 🤖🏆</span>","bot"); STATE.turn=0; return; }
  } else {
    log("Bot: no legal move found.","bot");
  }
}

function applyMove(m, isHuman){
  if (m.from === m.to) return;
  const player = isHuman ? 1 : 2;
  if (!isLegalMove(STATE.board, player, m)) {
    STATE.selected=null; STATE.legal=[]; draw();
    log("Illegal move ignored.", isHuman? "human":"bot"); return;
  }
  const who = STATE.board[m.from];
  STATE.board[m.from]=0; STATE.board[m.to]=who;
  m.path = m.path || [m.from, m.to];
  STATE.lastMove = m;

  STATE.turn = (who===1?2:1);
  STATE.selected=null; STATE.legal=[];
  STATE.hints.me=null; STATE.hints.bot=null;

  STATE.history.push({board: cloneBoard(STATE.board), turn: STATE.turn, last: m});
  if(isHuman) log(`You: ${coordString(m.from)} → ${coordString(m.to)} (${m.type})`, "human");
  else log(`Bot: ${coordString(m.from)} → ${coordString(m.to)} (${m.type})`, "bot");
}

// Help (persistent, reliable)
function setBusy(btn, flag){ if(!btn) return; btn.disabled=!!flag; }
async function showMyBest(){
  if(STATE.hintBusy.me) return; STATE.hintBusy.me=true; setBusy(btnMyBest,true);
  try{
    const L = LEVELS[5]; // Always teach with Master strength
    const ms = timeForLevel(Math.min(STATE.settings.botMs, 1400), L);
    const {bestMove} = searchRoot(cloneBoard(STATE.board), 1, ms, STATE.settings.style, STATE.lastMove, L);
    STATE.hints.me = (bestMove && isLegalMove(STATE.board,1,bestMove)) ? bestMove : null;
    if(STATE.hints.me){ log(`Hint (You): ${coordString(bestMove.from)} → ${coordString(bestMove.to)} (${bestMove.type})`, "human"); }
    else { log("Hint (You): no move found.","human"); }
    draw();
  } finally { STATE.hintBusy.me=false; setBusy(btnMyBest,false); }
}
async function showBotNext(){
  if(STATE.hintBusy.bot) return; STATE.hintBusy.bot=true; setBusy(btnBotNext,true);
  try{
    const L = LEVELS[STATE.settings.level] || LEVELS[3];
    const ms = timeForLevel(Math.min(STATE.settings.botMs, 1400), L);
    const {bestMove} = searchRoot(cloneBoard(STATE.board), 2, ms, STATE.settings.style, STATE.lastMove, L);
    STATE.hints.bot = (bestMove && isLegalMove(STATE.board,2,bestMove)) ? bestMove : null;
    if(STATE.hints.bot){ log(`Hint (Bot): ${coordString(bestMove.from)} → ${coordString(bestMove.to)} (${bestMove.type})`, "bot"); }
    else { log("Hint (Bot): no move found.","bot"); }
    draw();
  } finally { STATE.hintBusy.bot=false; setBusy(btnBotNext,false); }
}
function clearHints(){ STATE.hints.me=null; STATE.hints.bot=null; draw(); }

btnMyBest?.addEventListener("click", showMyBest);
btnBotNext?.addEventListener("click", showBotNext);
btnClear?.addEventListener("click", clearHints);

// ---------------- Drawing (dark + wood themes) ----------------
function marbleGradient(x,y,r,base){
  const g = ctx.createRadialGradient(x - r*0.35, y - r*0.35, r*0.1, x, y, r);
  g.addColorStop(0, "rgba(255,255,255,0.95)");
  g.addColorStop(0.05, "rgba(255,255,255,0.6)");
  g.addColorStop(0.25, base);
  g.addColorStop(0.95, "#000000");
  return g;
}
function drawPiece(idx, who, theme){
  const [px,py]=P(BOARD.cells[idx]), r=STATE.layout.pegR;
  ctx.save();
  ctx.beginPath(); ctx.arc(px,py,r,0,Math.PI*2);
  if(theme==="wood"){
    const base = (who===1? "#4aa3ff" : "#ff4e4e");
    ctx.fillStyle = marbleGradient(px,py,r,base);
    ctx.fill();
    ctx.lineWidth=1.5; ctx.strokeStyle="rgba(0,0,0,.35)"; ctx.stroke();
    ctx.beginPath(); ctx.arc(px-r*0.35, py-r*0.35, r*0.25, 0, Math.PI*2);
    ctx.fillStyle="rgba(255,255,255,.35)"; ctx.fill();
  } else {
    ctx.fillStyle = (who===1? "#5aa2ff" : "#ff6363");
    ctx.fill();
    ctx.lineWidth=2; ctx.strokeStyle="rgba(0,0,0,.3)"; ctx.stroke();
  }
  if(STATE.selected===idx){
    ctx.beginPath(); ctx.arc(px,py,r+5,0,Math.PI*2);
    ctx.lineWidth=2.5; ctx.strokeStyle=(theme==="wood" ? "rgba(255,215,120,.95)" : "rgba(255,255,255,.95)");
    ctx.stroke();
  }
  ctx.restore();
}
function drawHole(x,y,r,theme){
  if(theme==="wood"){
    const g = ctx.createRadialGradient(x, y, r*0.1, x, y, r*1.06);
    g.addColorStop(0, "#e6c79c"); g.addColorStop(0.6, "#c79c62"); g.addColorStop(1, "#8c6239");
    ctx.fillStyle=g; ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(x,y,r*0.85,0,Math.PI*2);
    ctx.lineWidth=r*0.25; ctx.strokeStyle="rgba(0,0,0,.2)"; ctx.stroke();
  }else{
    ctx.beginPath(); ctx.arc(x,y,r,0,Math.PI*2);
    ctx.fillStyle="#cfd6ea"; ctx.fill();
    ctx.beginPath(); ctx.arc(x,y,r-1.3,0,Math.PI*2);
    ctx.fillStyle="#f1f4ff"; ctx.fill();
    ctx.strokeStyle="rgba(255,255,255,.12)"; ctx.lineWidth=1; ctx.stroke();
  }
}
function drawLattice(theme){
  ctx.save();
  if(theme==="wood"){ ctx.strokeStyle="rgba(0,0,0,.25)"; ctx.lineWidth=1.2; }
  else{ ctx.strokeStyle="rgba(255,255,255,.06)"; ctx.lineWidth=1; }
  for(const c of BOARD.cells){
    const [px,py]=P(c);
    for(const nbIdx of c.nei){
      const nb=BOARD.cells[nbIdx];
      if(nb.idx < c.idx) continue;
      const [nx,ny]=P(nb);
      ctx.beginPath(); ctx.moveTo(px,py); ctx.lineTo(nx,ny); ctx.stroke();
    }
  }
  ctx.restore();
}
function tintTriangles(theme){
  function tint(indices, color, alpha){
    ctx.save(); ctx.fillStyle=color;
    for(const idx of indices){ const [x,y]=P(BOARD.cells[idx]); ctx.beginPath(); ctx.globalAlpha=alpha; ctx.arc(x,y, STATE.layout.holeR+7, 0, Math.PI*2); ctx.fill(); }
    ctx.restore();
  }
  if(theme==="wood"){
    tint(BOARD.SOUTH, "rgba(30,144,255,1)", 0.08);
    tint(BOARD.NORTH, "rgba(255,69,58,1)", 0.08);
  }else{
    tint(BOARD.SOUTH, "rgba(90,162,255,0.09)", 1);
    tint(BOARD.NORTH, "rgba(255,99,99,0.09)", 1);
  }
}
function drawPathMove(m, ringColor, pathColor){
  const [px,py]=P(BOARD.cells[m.to]);
  ctx.beginPath(); ctx.arc(px,py, STATE.layout.holeR+6, 0, Math.PI*2);
  ctx.lineWidth=3; ctx.strokeStyle=ringColor; ctx.stroke();
  if(m.path && m.path.length>1){
    ctx.beginPath();
    for(let i=0;i<m.path.length;i++){
      const [x,y]=P(BOARD.cells[m.path[i]]);
      if(i===0) ctx.moveTo(x,y); else ctx.lineTo(x,y);
    }
    ctx.setLineDash([6,6]);
    ctx.lineWidth=2.2; ctx.strokeStyle=pathColor; ctx.stroke();
    ctx.setLineDash([]);
  }
}
function drawHighlights(theme){
  for(const m of STATE.legal){
    const ring = (theme==="wood" ? (m.type==="hop" ? "rgba(240,200,70,.95)" : "rgba(255,255,255,.85)")
                                 : (m.type==="hop" ? "rgba(43,220,144,.95)" : "rgba(230,240,255,.9)"));
    const path = (theme==="wood" ? "rgba(240,200,70,.7)" : "rgba(43,220,144,.7)");
    drawPathMove(m, ring, path);
  }
  const me = STATE.hints.me, bot = STATE.hints.bot;
  if(me){ const ring="rgba(80,200,255,.95)", path="rgba(80,200,255,.7)"; drawPathMove(me, ring, path); }
  if(bot){ const ring=(theme==="wood"?"rgba(240,200,70,.95)":"rgba(255,165,0,.95)"); const path=(theme==="wood"?"rgba(240,200,70,.7)":"rgba(255,165,0,.7)"); drawPathMove(bot, ring, path); }
}
function drawLastMove(theme){
  if(!STATE.lastMove) return;
  const m = STATE.lastMove;
  const color = (theme==="wood" ? "rgba(0,0,0,.28)" : "rgba(255,255,255,.28)");
  ctx.save();
  ctx.lineWidth = 3; ctx.strokeStyle = color; ctx.lineJoin = "round"; ctx.lineCap = "round";
  if (m.path && m.path.length > 1) {
    ctx.beginPath();
    for (let i = 0; i < m.path.length; i++) {
      const [x, y] = P(BOARD.cells[m.path[i]]);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  } else {
    const A = BOARD.cells[m.from], B = BOARD.cells[m.to];
    const [ax, ay] = P(A), [bx, by] = P(B);
    ctx.beginPath(); ctx.moveTo(ax, ay); ctx.lineTo(bx, by); ctx.stroke();
  }
  ctx.restore();
}
function draw(){
  const W=canvas.clientWidth, H=canvas.clientHeight;
  ctx.clearRect(0,0,W,H);

  // pick theme from settings; keep old behavior if needed
  const theme = STATE.settings.theme || "dark";
  if (document.body) document.body.dataset.theme = theme;

  if(theme==="wood"){
    const b = pixelBounds();
    const cx=b.cx, cy=b.cy;
    const maxdx = Math.max(cx - b.minX, b.maxX - cx);
    const maxdy = Math.max(cy - b.minY, b.maxY - cy);
    const radius = Math.max(maxdx, maxdy) + 40;
    const wood = ctx.createRadialGradient(cx, cy, radius*0.1, cx, cy, radius);
    wood.addColorStop(0, "#e8c99a"); wood.addColorStop(0.5, "#cda876"); wood.addColorStop(1, "#8b5a2b");
    ctx.save();
    ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI*2);
    ctx.fillStyle=wood; ctx.fill();
    ctx.beginPath(); ctx.arc(cx, cy, radius, 0, Math.PI*2);
    ctx.lineWidth=16; ctx.strokeStyle="rgba(0,0,0,.35)"; ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, radius-10, 0, Math.PI*2);
    ctx.lineWidth=6; ctx.strokeStyle="rgba(255,255,255,.18)"; ctx.stroke();
    ctx.restore();
  }

  drawLattice(theme);
  tintTriangles(theme);
  for(const c of BOARD.cells){ const [px,py]=P(c); drawHole(px,py,STATE.layout.holeR,theme); }
  for(let i=0;i<STATE.board.length;i++) if(STATE.board[i]!==0) drawPiece(i, STATE.board[i], theme);
  drawHighlights(theme);
  drawLastMove(theme);
}

// ---------------- Boot ----------------
setupNewGame();
resizeCanvas();
//hello