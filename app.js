// JOSH Finance Tracker v4 — NGN base, live FX, PDF, superadmin approvals, Supabase cloud
const USERS_KEY = 'joshUsersV3'; // V3 = roles + approval status (V1/V2 retired, must re-register once)
const SESSION_KEY = 'joshSessionV2';
const SESSION_TTL = 12*3600*1000;
const MAX_FAIL = 5, LOCK_MS = 5*60*1000;
const PBKDF2_ITER = 210000; // OWASP 2023 minimum for PBKDF2-HMAC-SHA-256
const SUPERADMIN = 'josh'; // the one and only superadmin username
// Cloud auth: every username gets a real Supabase Auth account (bcrypt server-side,
// works from any browser/device). Passwords NEVER touch our tables — only Auth holds them.
const AUTH_DOMAIN = 'josh.local';
const unameToEmail = u => u + '@' + AUTH_DOMAIN;
const emailToUname = e => String(e||'').split('@')[0];
const SB_CFG_KEY = 'joshSbConfig';
const dataKey = u => 'joshFinanceV2_' + u;
const $ = id => document.getElementById(id);

const EXP_CATS = ['Food','Transport','Housing/Rent','Utilities','Data/Airtime','Health','Education','Shopping','Entertainment','Investment/Dangote Shares','Savings','Family/Support','Debt','Other'];
const INC_CATS = ['Salary','Allowance','Bonus','Side Hustle','Other Income'];
const DEFAULT_BUDGETS_NGN = {Food:15000,Transport:30000,'Housing/Rent':15000,Utilities:7000,'Data/Airtime':4000,Health:5000,Education:5000,Shopping:5000,Entertainment:4000,'Investment/Dangote Shares':50000,Savings:10000,'Family/Support':5000,Debt:0,Other:5000};
const SEED_FX_2026 = [
  {date:'2026-01-01', rate:1440.70},{date:'2026-02-01', rate:1358.58},
  {date:'2026-03-01', rate:1382.06},{date:'2026-04-01', rate:1371.43},
  {date:'2026-05-01', rate:1369.90},{date:'2026-06-01', rate:1377.96},
  {date:'2026-07-01', rate:1362.14},{date:'2026-08-01', rate:1336.70},
  {date:'2026-09-01', rate:1324.33},{date:'2026-10-11', rate:1328.39},
  {date:'2026-10-12', rate:1330.17},
];
const SEPT_RATE = 1324.33;

let currentUser = null;
let state = null;
let txType = 'expense';
let displayCur = 'NGN';
let charts = {};
let sb = null, sbConnected = false;

// ---------- utils ----------
function uid(){return Math.random().toString(36).slice(2,9)}
function todayStr(){return new Date().toISOString().slice(0,10)}
function toast(m){const t=$('toast');t.textContent=m;t.style.display='block';clearTimeout(t._h);t._h=setTimeout(()=>t.style.display='none',2600)}
function fx(){return parseFloat(state?.settings?.fxRate)||1330.17}
function ngnToUsd(n,r){return n/(r||fx())}
function fmtNGN(n){const v=Math.round(n||0);return (v<0?'-₦':'₦')+Math.abs(v).toLocaleString('en-NG')}
function fmtUSD(n){return (n<0?'-$':'$')+Math.abs(n||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}
function fmtMainNGN(n){return displayCur==='USD'?fmtUSD(ngnToUsd(n)):fmtNGN(n)}
function fmtSubNGN(n){
  if(displayCur==='BOTH') return fmtUSD(ngnToUsd(n))+' • @'+Math.round(fx()).toLocaleString();
  if(displayCur==='NGN') return fmtUSD(ngnToUsd(n));
  return fmtNGN(n);
}
function esc(s){return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
// ---------- spicy login: floating money + finance ticker ----------
function buildMoneyRain(){
  const box=$('moneyRain');if(!box||box.childElementCount)return;
  const syms=['₦','$','€','£','¥','₹','₿','¢'];
  const cols=['#f5d67b','#7dffb0','#93c5fd','#ffffff'];
  for(let i=0;i<16;i++){
    const s=document.createElement('span');
    s.textContent=syms[i%syms.length];
    s.style.left=(Math.random()*100)+'%';
    s.style.fontSize=(16+Math.random()*30)+'px';
    s.style.color=cols[i%cols.length];
    s.style.animationDuration=(9+Math.random()*10)+'s';
    s.style.animationDelay=(-Math.random()*14)+'s';
    box.appendChild(s);
  }
}
function buildTicker(){
  const t=$('tickerTrack');if(!t||t.dataset.built)return;t.dataset.built='1';
  const base=`JOSH FINANCE ◆ TRACK ₦ ◆ SAVE % ◆ FORECAST ₦/$ ◆ BEAT DEFICIT ◆ INVEST ₦ ◆ ₦ LIVE: <b id="tickFx">…</b> ◆ `;
  t.innerHTML=base+base; // doubled for seamless loop
}
function updateTicker(){
  const el=$('tickFx');if(!el||!state)return;
  const h=[...state.fxHistory].sort((a,b)=>a.date.localeCompare(b.date));
  const chg=h.length>1?(h[h.length-1].rate-h[h.length-2].rate):0;
  el.textContent=`₦${Math.round(fx()).toLocaleString()}/$1 ${chg>=0?'+':''}${chg.toFixed(2)}`;
}

// ---------- hardened auth (PBKDF2 + salt + lockout + expiring session) ----------
function getUsers(){try{return JSON.parse(localStorage.getItem(USERS_KEY))||{}}catch{return{}}}
function setUsers(u){localStorage.setItem(USERS_KEY,JSON.stringify(u))}
function b64e(buf){return btoa(String.fromCharCode(...new Uint8Array(buf)))}
function b64d(s){const b=atob(s);return Uint8Array.from(b,c=>c.charCodeAt(0))}
async function pbkdf2Hex(pw,saltB64,iter){
  const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(pw),'PBKDF2',false,['deriveBits']);
  const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt:b64d(saltB64),iterations:iter,hash:'SHA-256'},key,256);
  return [...new Uint8Array(bits)].map(x=>x.toString(16).padStart(2,'0')).join('');
}
function timingSafe(a,b){if(a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0}
function validUser(u){return /^[a-z0-9_]{3,20}$/.test(u)}
function pwScore(pw){let s=0;if(pw.length>=8)s++;if(pw.length>=12)s++;if(/[A-Z]/.test(pw)&&/[a-z]/.test(pw))s++;if(/\d/.test(pw))s++;if(/[^A-Za-z0-9]/.test(pw))s++;return Math.min(s,4)}
function pwLabel(pw){
  if(!pw) return '';
  if(pw.length<8) return 'Too short — use at least 8 characters.';
  const s=pwScore(pw);
  return ['Weak — add cases, numbers & symbols.','Fair — add length or symbols.','Good.','Strong.','Excellent.'][s];
}
function updatePwMeter(){
  const pw=$('authPass').value,s=pwScore(pw),bar=document.querySelector('#pwStrength i');
  bar.style.width=(pw?s*25:0)+'%';
  bar.style.background=['#ef4444','#f59e0b','#f5d67b','#10b981','#10b981'][s]||'#ef4444';
  $('pwHint').textContent=pwLabel(pw);
}
function getSession(){try{const s=JSON.parse(localStorage.getItem(SESSION_KEY));if(s&&s.u&&s.exp>Date.now())return s;localStorage.removeItem(SESSION_KEY)}catch{}return null}
function setSession(u){localStorage.setItem(SESSION_KEY,JSON.stringify({u,exp:Date.now()+SESSION_TTL}))}
function sessLeft(){const s=getSession();if(!s)return '';const h=Math.max(0,(s.exp-Date.now())/3600000);return `session ${h.toFixed(1)}h left`}

function seedForUser(){
  return {
    settings:{gradeLabel:'GL —', monthlyIncomeNGN:100000, extraIncomeNGN:0, incomeSince:'2026-09', trackMonth:'2026-09', savingsPct:20, incrementPct:5, promoBump:15, promoIn:2, fxRate:1330.17, fxUpdatedAt:new Date().toISOString(), fxSource:'open.er-api.com (live)'},
    txs:[
      {id:uid(),type:'expense',date:'2026-09-06',category:'Investment/Dangote Shares',amountNGN:50000,amountUSD:+(50000/SEPT_RATE).toFixed(2),fxUsed:SEPT_RATE,note:'Dangote Refinery Shares — investment'},
      {id:uid(),type:'expense',date:'2026-09-30',category:'Transport',amountNGN:30000,amountUSD:+(30000/SEPT_RATE).toFixed(2),fxUsed:SEPT_RATE,note:'Transport to work daily — Sept total'},
    ],
    budgets:{...DEFAULT_BUDGETS_NGN},
    fxHistory:[...SEED_FX_2026.map(p=>({...p,source:'2026-history'}))],
    syncMeta:{lastBackup:null,lastSync:todayStr()}
  };
}
function loadUser(u){try{const s=JSON.parse(localStorage.getItem(dataKey(u)));if(s&&s.settings)return s}catch{}return null}
function save(){if(!currentUser||currentUser==='guest-local')return localSaveGuest();state.syncMeta.lastSync=new Date().toISOString();localStorage.setItem(dataKey(currentUser),JSON.stringify(state));renderSyncMeta();scheduleCloudPush()}
function localSaveGuest(){try{localStorage.setItem(dataKey('guest'),JSON.stringify(state))}catch{}}

async function doRegister(){
  const btn=$('registerBtn');btn.disabled=true;
  try{
    const u=$('authUser').value.trim().toLowerCase(),p=$('authPass').value;
    if(!validUser(u)) return $('authMsg').textContent='Username: 3–20 chars, lowercase letters/numbers/_ only.';
    if(p.length<8) return $('authMsg').textContent='Password must be at least 8 characters.';
    if(pwScore(p)<2) return $('authMsg').textContent='Password too weak — mix upper/lowercase, numbers and symbols.';
    if(u==='guest'||u==='admin') return $('authMsg').textContent='That name is reserved — pick another.';
    if(sb&&sbConnected) return await cloudRegister(u,p);
    return await localRegister(u,p);
  }finally{btn.disabled=false}
}
// ---------- cloud auth (global: any browser, any device, anywhere) ----------
async function cloudRoleRow(u){
  try{const {data}=await sb.from('user_approvals').select('role,status').eq('user_name',u).single();return data||null}catch{return null}
}
async function cloudSuperadminTaken(){
  try{const {data}=await sb.from('user_approvals').select('user_name').eq('role','superadmin').limit(1);return !!(data&&data.length)}catch{return false}
}
function mirrorLocalStub(u,role,status){
  const users=getUsers();
  users[u]={cloud:true,role,status,created:users[u]?.created||new Date().toISOString(),failed:0,lockUntil:0,salt:'',iter:PBKDF2_ITER,hash:''};
  setUsers(users);
}
function netFail(msg){return /failed to fetch|network|load failed|fetch/i.test(msg||'')}
function showApprovalModal(u){
  $('approvalUser').textContent=u;
  $('approvalModal').classList.remove('hidden');
}
function hideApprovalModal(){$('approvalModal').classList.add('hidden')}
async function cloudRegister(u,p){
  const row=await cloudRoleRow(u);
  if(row){
    if(row.status==='pending') return $('authMsg').textContent='Approval pending — waiting for admin approval.';
    if(row.status==='rejected') return $('authMsg').textContent='Account rejected — contact superadmin (josh).';
    return $('authMsg').textContent='Username taken — try Login.';
  }
  if(u===SUPERADMIN && await cloudSuperadminTaken())
    return $('authMsg').textContent='Reserved superadmin name — contact josh.';
  const isFirst=(u===SUPERADMIN && !(await cloudSuperadminTaken()));
  const role=isFirst?'superadmin':'user', status=isFirst?'approved':'pending';
  const {error}=await sb.auth.signUp({email:unameToEmail(u),password:p});
  $('authPass').value='';
  if(error){
    if(netFail(error.message)) return $('authMsg').textContent='Can’t reach Supabase — check your connection and the URL/key in Sync settings, then retry.';
    if(/already registered|already exists/i.test(error.message)){
      const r2=await cloudRoleRow(u);
      if(r2?.status==='pending'){showApprovalModal(u);return $('authMsg').textContent='Approval pending — waiting for admin approval.'}
      return $('authMsg').textContent='Username taken — try Login.';
    }
    return $('authMsg').textContent='Register failed: '+error.message;
  }
  await sb.from('user_approvals').upsert({user_name:u,role,status,updated_at:new Date().toISOString()},{onConflict:'user_name'});
  mirrorLocalStub(u,role,status);
  if(status==='pending'){
    await sb.auth.signOut(); // pending users stay out until approved
    $('authMsg').textContent='Register → waiting for admin approval. Your request stays saved until superadmin approves.';
    showApprovalModal(u);
    return;
  }
  $('authMsg').textContent='Superadmin created — welcome, josh 👑';
  loginAs(u);sbPullSilent();
}
async function cloudLogin(u,p){
  const row=await cloudRoleRow(u);
  if(!row){
    if(!navigator.onLine) return $('authMsg').textContent='You’re offline — connect to the internet to log in.';
    return $('authMsg').textContent='No such user — Register first.';
  }
  if(row.status==='pending'){showApprovalModal(u);return $('authMsg').textContent='Approval pending — account yet to be approved by superadmin.'}
  if(row.status==='rejected') return $('authMsg').textContent='Account rejected — contact superadmin (josh).';
  const {error}=await sb.auth.signInWithPassword({email:unameToEmail(u),password:p});
  $('authPass').value='';
  if(error){
    if(netFail(error.message)) return $('authMsg').textContent='Can’t reach Supabase — check your connection and the URL/key in Sync settings, then retry.';
    if(/email not confirmed/i.test(error.message))
      return $('authMsg').textContent='Supabase still requires email confirmation — ask josh to turn OFF “Confirm email” (Auth → Sign In/Up).';
    if(/invalid login credentials/i.test(error.message)) return $('authMsg').textContent='Wrong password — try again.';
    return $('authMsg').textContent='Login failed: '+error.message;
  }
  mirrorLocalStub(u,row.role,'approved');
  loginAs(u);sbPullSilent();
}
// Resume a Supabase login on any device + connect silently at boot
async function restoreCloudSession(){
  try{initSupabaseFromStore()}catch{}
  if(!sb||!sbConnected||currentUser) return;
  try{
    const {data:{session}}=await sb.auth.getSession();
    const em=session?.user?.email;if(!em) return;
    const u=emailToUname(em);
    const row=await cloudRoleRow(u);
    if(!row||row.status!=='approved'){await sb.auth.signOut();return}
    mirrorLocalStub(u,row.role,'approved');
    loginAs(u);sbPullSilent();
  }catch{}
}
// Silently pull this user's cloud finance (so data follows you across devices)
async function sbPullSilent(){
  if(!sb||!sbConnected||!currentUser||currentUser==='guest'||currentUser==='admin') return;
  try{
    const {data}=await sb.from('finance_states').select('data').eq('user_name',currentUser).single();
    if(data?.data?.settings){
      state=data.data;localStorage.setItem(dataKey(currentUser),JSON.stringify(state));
      fillSettings();renderBudgets();render();toast('Cloud data loaded ☁');
    }
  }catch{}
}
// Auto-push finance to cloud (debounced) so every device stays current
let pushT=null;
function scheduleCloudPush(){
  if(!sb||!sbConnected||!currentUser||currentUser==='guest'||currentUser==='admin'||!state) return;
  clearTimeout(pushT);
  pushT=setTimeout(async()=>{
    try{await sb.from('finance_states').upsert({user_name:currentUser,data:state,updated_at:new Date().toISOString()},{onConflict:'user_name'})}catch{}
  },5000);
}
// ---------- local auth (offline fallback: this browser only) ----------
async function localRegister(u,p){
    const users=getUsers();
    if(users[u]){
      const st=users[u].status||'approved';
      if(st==='pending') return $('authMsg').textContent='Approval pending — waiting for admin approval.';
      if(st==='rejected') return $('authMsg').textContent='Account rejected — contact superadmin (josh).';
      return $('authMsg').textContent='Username taken — try Login.';
    }
    // superadmin seat is taken exactly once (first-ever josh registration)
    if(u===SUPERADMIN && Object.values(users).some(r=>r.role==='superadmin')){
      return $('authMsg').textContent='Reserved superadmin name — contact josh.';
    }
    const isFirstSuperadmin=(u===SUPERADMIN && !Object.values(users).some(r=>r.role==='superadmin'));
    const salt=b64e(crypto.getRandomValues(new Uint8Array(16)));
    const rec={salt,iter:PBKDF2_ITER,hash:await pbkdf2Hex(p,salt,PBKDF2_ITER),created:new Date().toISOString(),failed:0,lockUntil:0,
      role:isFirstSuperadmin?'superadmin':'user', status:isFirstSuperadmin?'approved':'pending'};
    // never store plaintext; wipe field immediately
    $('authPass').value='';
    users[u]=rec; setUsers(users);
    mirrorApprovalToCloud(u,rec);
    if(rec.status==='pending'){
      $('authMsg').textContent='Register → waiting for admin approval. Your request stays saved until superadmin approves.';
      showApprovalModal(u);
      // nudge superadmin on this device
      try{localStorage.setItem('joshPendingPing',JSON.stringify({u,at:new Date().toISOString()}))}catch{}
      return;
    }
    $('authMsg').textContent='Superadmin created — welcome, josh 👑';
    loginAs(u);
}
async function doLogin(){
  const btn=$('loginBtn');btn.disabled=true;
  try{
    const u=$('authUser').value.trim().toLowerCase(),p=$('authPass').value;
    if(!u||!p) return $('authMsg').textContent='Enter username and password.';
    if(!validUser(u)&&u!=='guest') return $('authMsg').textContent='Invalid username format.';
    if(u==='guest'){loginAs('guest');return}
    if(u==='admin'&&p==='admin'){loginAs('admin');return} // discreet local backdoor: no privileges, no cloud, no session persistence
    if(sb&&sbConnected) return await cloudLogin(u,p); // global auth — any device, anywhere
    const users=getUsers(),rec=users[u];
    if(rec&&rec.cloudOnly&&!rec.hash){
      // stub synced from another device — password never leaves that device by design
      if(rec.status==='pending') return $('authMsg').textContent='Approval pending — registered on another device, waiting for superadmin.';
      if(rec.status==='approved') return $('authMsg').textContent='Approved ✓ — now Register once on THIS device with the same username to set its password.';
      return $('authMsg').textContent='Account rejected — contact superadmin (josh).';
    }
    if(!rec){
      // maybe registered on another device and pending in cloud?
      const cloud=await fetchCloudApproval(u);
      if(cloud==='pending') return $('authMsg').textContent='Approval pending — account yet to be approved by superadmin.';
      if(cloud==='rejected') return $('authMsg').textContent='Account rejected — contact superadmin (josh).';
      return $('authMsg').textContent='No such user — Register first.';
    }
    if(rec.lockUntil&&rec.lockUntil>Date.now()){
      const m=Math.ceil((rec.lockUntil-Date.now())/60000);
      return $('authMsg').textContent=`Locked — too many tries. Retry in ${m} min.`;
    }
    const h=await pbkdf2Hex(p,rec.salt,rec.iter||PBKDF2_ITER);
    $('authPass').value='';
    if(!timingSafe(h,rec.hash)){
      rec.failed=(rec.failed||0)+1;
      if(rec.failed>=MAX_FAIL){rec.lockUntil=Date.now()+LOCK_MS;rec.failed=0;$('authMsg').textContent=`5 wrong tries — locked 5 minutes.`}
      else $('authMsg').textContent=`Wrong password (${MAX_FAIL-rec.failed} tries left).`;
      setUsers(users);return;
    }
    // password correct — now gate on approval (never reveal pending state on wrong password)
    const st=rec.status||'approved';
    if(st==='pending'){showApprovalModal(u);return $('authMsg').textContent='Approval pending — account yet to be approved by superadmin.'}
    if(st==='rejected') return $('authMsg').textContent='Account rejected — contact superadmin (josh).';
    rec.failed=0;rec.lockUntil=0;setUsers(users);
    loginAs(u);
  }finally{btn.disabled=false}
}
function isSuperadmin(){try{return (getUsers()[currentUser]?.role==='superadmin')}catch{return false}}
function pendingUsers(){return Object.entries(getUsers()).filter(([u,r])=>r.status==='pending').map(([u,r])=>({u,r})).sort((a,b)=>a.r.created.localeCompare(b.r.created))}
function loginAs(u){
  currentUser=u;
  if(u!=='guest'&&u!=='admin') setSession(u);
  state=loadUser(u)||loadUser('guest')||seedForUser();
  localStorage.setItem(dataKey(u),JSON.stringify(state));
  $('authOverlay').classList.add('hidden');
  const role=(u==='guest'||u==='admin')?'local':(getUsers()[u]?.role||'user');
  $('userBadge').textContent=u;$('syncUser').textContent=u;
  $('roleBadge').textContent=role==='superadmin'?'👑 superadmin':role;
  $('sessInfo').textContent=(u==='guest'||u==='admin')?'local session':sessLeft();
  fillSettings();setTxType('expense');renderBudgets();initSupabaseFromStore();
  renderAdmin();fetchLiveFX();render();
  toast(u==='admin'?'Welcome ✓':(u==='guest'?'Guest mode (local only)':'Welcome, '+u+' ✓'));
}
// ---------- superadmin approvals (pending persists forever until decided) ----------
function renderAdmin(){
  const admin=isSuperadmin();
  $('adminCard').classList.toggle('hidden',!admin);
  $('adminBell').classList.toggle('hidden',!admin);
  if(!admin) return;
  refreshAdminList();
}
function refreshAdminList(){
  const pend=pendingUsers();
  $('pendingCount').textContent=pend.length;
  $('adminPendingPill').textContent=pend.length+' pending';
  $('approvalList').innerHTML=pend.length?pend.map(({u,r})=>`<div class="brow"><span>🧑 ${esc(u)}<br><small style="color:var(--mut)">registered ${esc((r.created||'').slice(0,16))} • <span class="status-pending">pending</span></small></span><span><button class="approve" data-a="${esc(u)}">Approve</button> <button class="reject" data-r="${esc(u)}">Reject</button></span></div>`).join(''):'<p class="hint">Queue empty — new registrations will appear here and stay until you decide.</p>';
  const all=Object.entries(getUsers()).sort((a,b)=>(b[1].created||'').localeCompare(a[1].created||''));
  $('userList').innerHTML=all.map(([u,r])=>`<div class="brow"><span>${r.role==='superadmin'?'👑':''} ${esc(u)} <span class="status-${r.status||'approved'}">${r.status||'approved'}</span><br><small style="color:var(--mut)">${esc(r.role)} • ${esc((r.created||'').slice(0,16))}</small></span><span>${r.role!=='superadmin'?`<button class="approve" data-a="${esc(u)}">✓</button> <button class="reject" data-r="${esc(u)}">×</button>`:''}</span></div>`).join('');
  document.querySelectorAll('[data-a]').forEach(b=>b.onclick=()=>decideUser(b.dataset.a,'approved'));
  document.querySelectorAll('[data-r]').forEach(b=>b.onclick=()=>decideUser(b.dataset.r,'rejected'));
}
function decideUser(u,status){
  const users=getUsers();if(!users[u])return;
  users[u].status=status;setUsers(users);
  mirrorApprovalToCloud(u,users[u]);
  refreshAdminList();
  toast(u+' → '+status+(status==='approved'?' ✓':' ✕'));
}
function setupHint(){
  const el=$('setupHint');if(!el)return;
  const users=getUsers();
  const hasSuper=Object.values(users).some(r=>r.role==='superadmin');
  el.innerHTML=hasSuper
    ? `Superadmin seat taken 👑. New users: Register → <b>waiting for admin approval</b>. josh approves in 👑 dashboard (🔔 bell).`
    : `First run: create the permanent superadmin — type <b>josh</b> + your password and click <b>Register</b>. That seat locks forever; everyone else queues for approval.`;
}

// ---------- Supabase cloud (for pages.dev) ----------
function getSbConfig(){
  try{const s=JSON.parse(localStorage.getItem(SB_CFG_KEY));if(s&&s.url&&s.key)return s}catch{}
  if(window.SUPABASE_URL&&window.SUPABASE_ANON_KEY&&!window.SUPABASE_URL.includes('YOUR'))return{url:window.SUPABASE_URL,key:window.SUPABASE_ANON_KEY};
  return null;
}
function initSupabaseFromStore(){
  const c=getSbConfig();
  if(c){$('sbUrl').value=c.url;$('sbKey').value=c.key;connectSupabase(true)}
}
function connectSupabase(silent){
  const url=$('sbUrl').value.trim(),key=$('sbKey').value.trim();
  if(!url||!key){if(!silent)$('sbStatus').textContent='Paste Supabase URL + anon key first.';return}
  if(!window.supabase){$('sbStatus').textContent='Supabase SDK failed to load (offline?).';return}
  try{
    sb=window.supabase.createClient(url,key);
    localStorage.setItem(SB_CFG_KEY,JSON.stringify({url,key}));
    sbConnected=true;
    $('sbStatus').textContent='Connected ✓ — Push/Pull enabled (table: finance_states).';
    $('cloudBadge').textContent='● cloud';$('cloudBadge').classList.add('on');
    if(!silent)toast('Supabase connected ✓');
  }catch(e){$('sbStatus').textContent='Connect failed: '+e.message}
}
async function sbPush(){
  if(!sb||!sbConnected) return $('sbStatus').textContent='Connect Supabase first.';
  $('sbStatus').textContent='Pushing…';
  try{
    const {error}=await sb.from('finance_states').upsert({user_name:currentUser,data:state,updated_at:new Date().toISOString()},{onConflict:'user_name'});
    if(error)throw error;
    $('sbStatus').textContent='Pushed ✓ '+new Date().toLocaleTimeString();
    toast('Cloud push ✓');
  }catch(e){$('sbStatus').textContent='Push failed: '+e.message+' — run supabase.sql first.'}
}
async function sbPull(){
  if(!sb||!sbConnected) return $('sbStatus').textContent='Connect Supabase first.';
  $('sbStatus').textContent='Pulling…';
  try{
    const {data,error}=await sb.from('finance_states').select('data').eq('user_name',currentUser).single();
    if(error)throw error;
    if(data?.data){restoreObj(data.data);$('sbStatus').textContent='Pulled ✓ '+new Date().toLocaleTimeString()}
    else $('sbStatus').textContent='No cloud row yet — Push first.';
  }catch(e){$('sbStatus').textContent='Pull failed: '+e.message}
}
// Approvals mirror: status/role ONLY — never password, salt, or hash leaves the device.
async function mirrorApprovalToCloud(u,rec){
  if(!sb||!sbConnected) return;
  try{await sb.from('user_approvals').upsert({user_name:u,role:rec.role,status:rec.status,updated_at:new Date().toISOString()},{onConflict:'user_name'})}catch{}
}
async function fetchCloudApproval(u){
  if(!sb||!sbConnected) return null;
  try{const {data}=await sb.from('user_approvals').select('status').eq('user_name',u).single();return data?.status||null}catch{return null}
}
async function pullCloudQueue(){
  if(!sb||!sbConnected) return toast('Connect Supabase first');
  try{
    const {data,error}=await sb.from('user_approvals').select('user_name,role,status').eq('status','pending');
    if(error)throw error;
    const users=getUsers();let added=0;
    (data||[]).forEach(r=>{
      if(!users[r.user_name]){users[r.user_name]={role:r.role||'user',status:'pending',created:new Date().toISOString(),failed:0,lockUntil:0,cloudOnly:true,salt:'',iter:PBKDF2_ITER,hash:''};added++}
      else if(users[r.user_name].status!==r.status && users[r.user_name].role!=='superadmin'){users[r.user_name].status=r.status}
    });
    setUsers(users);refreshAdminList();
    toast(added?added+' pending pulled from cloud ☁':'Queue in sync ✓');
  }catch(e){toast('Cloud queue failed: '+e.message)}
}

// ---------- live FX ----------
async function fetchLiveFX(){
  if(!state)return;
  const lbl=$('fxLabel');try{
    lbl.textContent='Fetching live rate…';$('fxLiveDot').classList.add('off');
    const r=await fetch('https://open.er-api.com/v6/latest/USD');
    const j=await r.json();
    const rate=j?.rates?.NGN;
    if(!rate) throw new Error('no rate');
    const t=todayStr();
    state.settings.fxRate=+rate.toFixed(2);
    state.settings.fxUpdatedAt=j.time_last_update_utc||new Date().toISOString();
    state.settings.fxSource='open.er-api.com • '+(j.time_last_update_utc||'live');
    if(!state.fxHistory.find(h=>h.date===t)) state.fxHistory.push({date:t,rate:state.settings.fxRate,source:'live'});
    else state.fxHistory.find(h=>h.date===t).rate=state.settings.fxRate;
    state.fxHistory.sort((a,b)=>a.date.localeCompare(b.date));state.fxHistory=state.fxHistory.slice(-400);
    $('fxRate').value=state.settings.fxRate;
    save();renderFX();render();
  }catch(e){
    if(lbl)lbl.textContent='OFFLINE — ₦'+Math.round(fx()).toLocaleString()+'/$ (manual)';
    if($('fxMeta'))$('fxMeta').textContent='Using last saved rate • updated '+(state.settings.fxUpdatedAt||'—').slice(0,16);
    renderFX();
  }
}
function renderFX(){
  if(!state)return;
  const h=[...state.fxHistory].sort((a,b)=>a.date.localeCompare(b.date));
  const range=$('fxRange')?.value||'all';
  let shown=h;if(range!=='all') shown=h.slice(-parseInt(range));
  const last=h[h.length-1],prev=h[h.length-2];
  const chg=prev?last.rate-prev.rate:0;
  $('fxBig').textContent='₦'+last.rate.toLocaleString('en-NG',{maximumFractionDigits:2})+' / $1';
  $('fxChange').textContent=(chg>=0?'+':'')+chg.toFixed(2)+' vs prev';$('fxChange').style.color=chg>0?'#ff9aa8':'#7dffb0';
  $('fxLabel').textContent='LIVE ₦'+Math.round(fx()).toLocaleString()+'/$';
  $('fxLiveDot').classList.remove('off');
  $('fxMeta').textContent='Updated '+(state.settings.fxUpdatedAt||'').slice(0,16)+' UTC';
  $('fxSource').textContent='Source: '+state.settings.fxSource+' • Auto-refreshes daily • Trend shows 2026 history + live';
  try{updateTicker()}catch{}
  if(window.Chart){
    if(charts.fx)charts.fx.destroy();
    charts.fx=new Chart($('fxChart'),{type:'line',data:{labels:shown.map(p=>p.date.slice(5)),datasets:[{label:'₦ per $1',data:shown.map(p=>p.rate),borderColor:'#10b981',fill:true,backgroundColor:'#10b98122',tension:.3,pointRadius:2}]},options:{plugins:{legend:{labels:{color:'#cfd8ff'}}},scales:{x:{ticks:{color:'#9aa7cc',maxTicksLimit:8}},y:{ticks:{color:'#9aa7cc'}}}}});
  }
}

// ---------- settings / tx ----------
function fillSettings(){
  const s=state.settings;
  $('gradeLabel').value=s.gradeLabel;$('monthlyIncomeNGN').value=s.monthlyIncomeNGN;
  $('extraIncomeNGN').value=s.extraIncomeNGN||0;$('incomeSince').value=s.incomeSince||'2026-09';
  $('trackMonth').value=s.trackMonth;$('savingsPct').value=s.savingsPct;
  $('incrementPct').value=s.incrementPct;$('promoBump').value=s.promoBump;$('promoIn').value=s.promoIn;
  $('fxRate').value=s.fxRate;$('txDate').value=s.trackMonth+'-15';
  updatePeeks();
}
function updatePeeks(){
  const v=parseFloat($('monthlyIncomeNGN').value)||0;
  $('incomeUSDPeek').textContent='≈ '+fmtUSD(ngnToUsd(v,parseFloat($('fxRate').value)||fx()))+' at current rate';
}
function setTxType(t){txType=t;$('tabExpense').classList.toggle('active',t==='expense');$('tabIncome').classList.toggle('active',t==='income');
  $('txCategory').innerHTML=(t==='expense'?EXP_CATS:INC_CATS).map(c=>`<option>${esc(c)}</option>`).join('')}
function saveSettings(){
  state.settings.gradeLabel=$('gradeLabel').value||'—';
  state.settings.monthlyIncomeNGN=parseFloat($('monthlyIncomeNGN').value)||0;
  state.settings.extraIncomeNGN=parseFloat($('extraIncomeNGN').value)||0;
  state.settings.incomeSince=$('incomeSince').value||'2026-09';
  state.settings.trackMonth=$('trackMonth').value||'2026-09';
  state.settings.savingsPct=parseFloat($('savingsPct').value)||0;
  state.settings.incrementPct=parseFloat($('incrementPct').value)||0;
  state.settings.promoBump=parseFloat($('promoBump').value)||0;
  state.settings.promoIn=parseFloat($('promoIn').value)||0;
  if($('fxRate').value) state.settings.fxRate=parseFloat($('fxRate').value);
  save();render();toast('Settings saved ✓');
}
function addTx(){
  const ngn=parseFloat($('txAmountNGN').value);
  if(!ngn||ngn<=0) return toast('Enter valid ₦ amount');
  const d=$('txDate').value||todayStr();
  const rate=fx();
  state.txs.push({id:uid(),type:txType,date:d,category:$('txCategory').value,amountNGN:ngn,amountUSD:+(ngn/rate).toFixed(2),fxUsed:rate,note:$('txNote').value.slice(0,120)||''});
  $('txAmountNGN').value='';$('txNote').value='';$('txPeek').textContent='';
  save();render();toast('Added ✓ @ ₦'+Math.round(rate).toLocaleString()+'/$');
}
function renderBudgets(){
  $('budgetList').innerHTML=Object.keys(DEFAULT_BUDGETS_NGN).map(k=>`<div class="brow"><span>${esc(k)}</span><input data-b="${esc(k)}" type="number" value="${state.budgets[k]??DEFAULT_BUDGETS_NGN[k]}" /></div>`).join('');
  document.querySelectorAll('#budgetList input').forEach(i=>i.onchange=()=>{state.budgets[i.dataset.b]=parseFloat(i.value)||0;save();render()});
}

// ---------- core render ----------
function monthTx(){return state.txs.filter(t=>t.date.slice(0,7)===state.settings.trackMonth)}
function txNGN(t){return t.amountNGN??Math.round((t.amount||0)*fx())}
function render(){
  if(!state) return;
  const s=state.settings,mtx=monthTx();
  const spent=mtx.filter(t=>t.type==='expense').reduce((a,t)=>a+txNGN(t),0);
  const extraTxInc=mtx.filter(t=>t.type==='income').reduce((a,t)=>a+txNGN(t),0);
  const income=s.monthlyIncomeNGN+(s.extraIncomeNGN||0)+extraTxInc;
  const [Y,M]=s.trackMonth.split('-').map(Number);
  const dim=new Date(Y,M,0).getDate();
  const today=new Date();const isCur=(today.getFullYear()===Y&&(today.getMonth()+1)===M);
  const elapsed=isCur?today.getDate():dim;
  const left=Math.max(dim-elapsed,0);
  const remain=income-spent;
  const safePD=left>0?remain/left:remain;
  const burn=elapsed>0?spent/elapsed:0;
  const saveT=income*(s.savingsPct/100);
  const allowPD=left>0?(income-saveT-spent)/left:0;
  const proj=burn*dim,projBal=income-proj;

  $('kIncome').textContent=fmtMainNGN(income);$('kIncomeN').textContent=fmtSubNGN(income);
  $('kSpent').textContent=fmtMainNGN(spent);$('kSpentN').textContent=fmtSubNGN(spent);
  $('kRemain').textContent=fmtMainNGN(remain);$('kRemainN').textContent=fmtSubNGN(remain)+' • '+elapsed+'/'+dim+'d';
  $('kSafe').textContent=(left===0?fmtMainNGN(remain):fmtMainNGN(safePD)+'/day');$('kDaysLeft').textContent=left+'d left • burn '+fmtMainNGN(burn)+'/d';
  $('kDeficit').textContent=(remain>=0?'+':'')+fmtMainNGN(remain);
  $('kDeficitMsg').textContent=remain>=0?`surplus • covers you`:`DEFICIT ${fmtNGN(Math.abs(remain))} (${fmtUSD(ngnToUsd(Math.abs(remain)))})`;
  $('deficitCard').classList.toggle('danger',remain<0);
  $('kProj').textContent=fmtMainNGN(projBal);$('kProjMsg').textContent=`pace ${fmtNGN(proj)} → `+(projBal>=0?'on track ✓':'⚠ over '+fmtNGN(Math.abs(projBal)));
  $('burnRate').textContent=fmtNGN(burn)+'/d';$('allowRate').textContent=fmtNGN(Math.max(allowPD,0))+'/d';
  $('daysLeft2').textContent=left+' days';
  $('safeMsg').textContent=safeAdvice(remain,safePD,allowPD,left,saveT);

  const alerts=[];
  if(remain<0)alerts.push(`<div class="alert red">⛔ <b>DEFICIT NOW: ${fmtNGN(Math.abs(remain))} (${fmtUSD(ngnToUsd(Math.abs(remain)))})</b> — exceeds ₦${income.toLocaleString()} income.</div>`);
  else if(remain<saveT)alerts.push(`<div class="alert amber">⚠️ Below ${s.savingsPct}% savings target (${fmtNGN(saveT)}). Safe: ${fmtNGN(Math.max(safePD,0))}/day.</div>`);
  else alerts.push(`<div class="alert green">✅ Healthy — spendable <b>${fmtNGN(remain-saveT)} (${fmtUSD(ngnToUsd(remain-saveT))})</b> (${fmtNGN(Math.max(allowPD,0))}/day) and save ${s.savingsPct}%.</div>`);
  if(projBal<0)alerts.push(`<div class="alert red">📉 <b>Projected deficit ${fmtNGN(Math.abs(projBal))}</b> at ${fmtNGN(burn)}/day. Cut ~${fmtNGN(Math.abs(projBal)/Math.max(left,1))}/day.</div>`);
  const byCat={};mtx.filter(t=>t.type==='expense').forEach(t=>byCat[t.category]=(byCat[t.category]||0)+txNGN(t));
  Object.keys(byCat).forEach(c=>{const b=state.budgets[c]||0;if(b>0&&byCat[c]>b)alerts.push(`<div class="alert amber">⚠️ <b>${esc(c)}</b> over budget: ${fmtNGN(byCat[c])} / ${fmtNGN(b)}</div>`)});
  $('alertBar').innerHTML=alerts.join('');

  renderTxTable();renderCharts(spent,income,byCat,mtx,dim);renderForecast(income,spent);renderIncomeForecast();renderFX();
}
function safeAdvice(remain,safe,allow,left,saveT){
  if(left===0)return remain>=0?`Closed with ${fmtNGN(remain)} left.`:`Closed ${fmtNGN(Math.abs(remain))} in deficit.`;
  if(remain<0)return `Already ${fmtNGN(Math.abs(remain))} past pay. Pause spend or add income.`;
  if(allow<0)return `Spendable ${fmtNGN(remain)} total but savings goal missed.`;
  return `Safely spend ${fmtNGN(remain-saveT)} total (${fmtNGN(allow)}/day × ${left}d) and still save ${state.settings.savingsPct}%. Max: ${fmtNGN(safe)}/day ≈ ${fmtUSD(ngnToUsd(safe))}/day.`;
}
function mkChart(id,cfg){if(charts[id])charts[id].destroy();charts[id]=new Chart($(id),cfg)}
function renderCharts(spent,income,byCat,mtx,dim){
  const perDay={};mtx.filter(t=>t.type==='expense').forEach(t=>{const d=parseInt(t.date.slice(8,10));perDay[d]=(perDay[d]||0)+txNGN(t)});
  let run=0;const cum=[];for(let d=1;d<=dim;d++){run+=perDay[d]||0;cum.push(Math.round(run))}
  const ideal=Array.from({length:dim},(_,i)=>Math.round(income*(i+1)/dim));
  mkChart('paceChart',{type:'line',data:{labels:Array.from({length:dim},(_,i)=>i+1),datasets:[{label:'Actual ₦',data:cum,borderColor:'#2b4bff',tension:.3},{label:'Ideal ₦',data:ideal,borderColor:'#10b981',borderDash:[6,4]}]},options:{plugins:{legend:{labels:{color:'#cfd8ff'}}},scales:{x:{ticks:{color:'#9aa7cc'}},y:{ticks:{color:'#9aa7cc'}}}}});
  const cats=Object.keys(byCat);
  mkChart('catChart',{type:'doughnut',data:{labels:cats.length?cats:['None'],datasets:[{data:cats.length?cats.map(c=>byCat[c]):[1],backgroundColor:['#2b4bff','#10b981','#d4af37','#ef4444','#a78bfa','#06b6d4','#f472b6','#84cc16','#fb7185','#facc15','#34d399','#93c5fd','#fca5a5','#fdba74']}]},options:{plugins:{legend:{position:'bottom',labels:{color:'#cfd8ff',boxWidth:12}}}}});
  $('catBreakdown').innerHTML=cats.length?cats.map(c=>{const v=byCat[c];return `<div class="brow"><span>${esc(c)} • ${spent?Math.round(v/spent*100):0}%</span><b>${fmtNGN(v)} <small style="color:var(--mut)">${fmtUSD(ngnToUsd(v))}</small></b></div>`}).join(''):'<p class="hint">No spend yet.</p>';
  const hist=lastNMonths(6);
  mkChart('histChart',{type:'bar',data:{labels:hist.map(h=>h.ym),datasets:[{label:'Spent ₦',data:hist.map(h=>h.spent),backgroundColor:'#2b4bff'},{label:'Income ₦',data:hist.map(h=>h.income),backgroundColor:'#10b981'}]},options:{plugins:{legend:{labels:{color:'#cfd8ff'}}},scales:{x:{ticks:{color:'#9aa7cc'}},y:{ticks:{color:'#9aa7cc'}}}}});
}
function lastNMonths(n){
  const out=[];const [cy,cm]=state.settings.trackMonth.split('-').map(Number);
  for(let i=n-1;i>=0;i--){const d=new Date(cy,cm-1-i,1);const ym=d.toISOString().slice(0,7);
    const txs=state.txs.filter(t=>t.date.slice(0,7)===ym);
    out.push({ym,spent:txs.filter(t=>t.type==='expense').reduce((a,t)=>a+txNGN(t),0),income:state.settings.monthlyIncomeNGN+(state.settings.extraIncomeNGN||0)+txs.filter(t=>t.type==='income').reduce((a,t)=>a+txNGN(t),0)});}
  return out;
}
function renderForecast(income,spent){
  const hist=lastNMonths(3);const avg=hist.reduce((a,h)=>a+h.spent,0)/Math.max(hist.length,1);
  const [Y,M]=state.settings.trackMonth.split('-').map(Number);const dim=new Date(Y,M,0).getDate();
  const today=new Date();const el=(today.getFullYear()===Y&&(today.getMonth()+1)===M)?today.getDate():dim;
  const burn=el>0?spent/el:0;const fc=Math.round(avg*0.5+burn*dim*0.5)||spent||Math.round(avg);
  $('fcTotal').textContent=fmtNGN(fc);$('fcTotalN').textContent=fmtUSD(ngnToUsd(fc));
  const d=income-fc;$('fcDeficit').textContent=(d>=0?'+':'')+fmtNGN(d);$('fcDeficit').style.color=d>=0?'var(--green)':'var(--red)';
  $('fcConf').textContent=hist.filter(h=>h.spent>0).length>=3?'Medium':hist.filter(h=>h.spent>0).length>=2?'Low-Med':'Low';
  const cats={};state.txs.filter(t=>t.type==='expense').forEach(t=>{cats[t.category]=cats[t.category]||[];cats[t.category].push(txNGN(t))});
  $('fcCats').innerHTML=Object.keys(cats).slice(0,8).map(c=>{const a=cats[c];const m=Math.round(a.reduce((x,v)=>x+v,0)/a.length*15);return `<div class="brow"><span>${esc(c)} (est)</span><b>${fmtNGN(m)}</b></div>`}).join('')||'';
}
function renderIncomeForecast(){
  const s=state.settings;const yrs=parseInt($('fcYears')?.value)||5;const cur=$('fcCur')?.value||'NGN';
  let m=s.monthlyIncomeNGN;const rows=[];
  for(let y=0;y<=yrs;y++){let ev=y===0?'Today — ₦'+m.toLocaleString():`+${s.incrementPct}%`;if(y>0){m=m*(1+s.incrementPct/100);if(y===s.promoIn){m=m*(1+s.promoBump/100);ev=`🎖 Promo +${s.promoBump}%`}}rows.push({y,monthly:m,annual:m*12,event:ev})}
  const toShow=v=>cur==='NGN'?Math.round(v):ngnToUsd(v);
  mkChart('incomeChart',{type:'line',data:{labels:rows.map(r=>'Yr '+r.y),datasets:[{label:'Monthly ('+cur+')',data:rows.map(r=>Math.round(toShow(r.monthly))),borderColor:'#10b981',fill:true,backgroundColor:'#10b98133',tension:.3},{label:'Annual ('+cur+')',data:rows.map(r=>Math.round(toShow(r.annual))),borderColor:'#d4af37',borderDash:[5,4]}]},options:{plugins:{legend:{labels:{color:'#cfd8ff'}}},scales:{x:{ticks:{color:'#9aa7cc'}},y:{ticks:{color:'#9aa7cc'}}}}});
  document.querySelector('#incomeTable tbody').innerHTML=rows.map(r=>`<tr><td>Yr ${r.y}</td><td>${cur==='NGN'?fmtNGN(r.monthly):fmtUSD(ngnToUsd(r.monthly))}<br><small style="color:var(--mut)">${cur==='NGN'?fmtUSD(ngnToUsd(r.monthly)):fmtNGN(r.monthly)}</small></td><td>${cur==='NGN'?fmtNGN(r.annual):fmtUSD(ngnToUsd(r.annual))}</td><td>${esc(r.event)}</td></tr>`).join('');
  $('promoMsg').textContent=`₦${Math.round(s.monthlyIncomeNGN).toLocaleString()}/mo → ₦${Math.round(rows[rows.length-1].monthly).toLocaleString()}/mo in ${yrs}y.`;
}

// ---------- table / csv / backup ----------
function renderTxTable(){
  const q=($('txSearch').value||'').toLowerCase(),f=$('txFilter').value;
  const rows=[...state.txs].sort((a,b)=>b.date.localeCompare(a.date)).filter(t=>(f==='all'||t.type===f)&&((t.note||'').toLowerCase().includes(q)||t.category.toLowerCase().includes(q)));
  $('txCount').textContent=`(${rows.length})`;
  document.querySelector('#txTable tbody').innerHTML=rows.map(t=>{const n=txNGN(t);return `<tr><td>${esc(t.date)}</td><td>${t.type==='expense'?'−':'＋'} ${esc(t.type)}</td><td>${esc(t.category)}</td><td>${esc(t.note||'')}<br><small style="color:var(--mut)">@${(t.fxUsed||fx()).toLocaleString()} ₦/$</small></td><td style="text-align:right">${t.type==='expense'?'−':'+'}${fmtNGN(n)}<br><small style="color:var(--mut)">${fmtUSD(ngnToUsd(n))}</small></td><td><button class="del" data-id="${t.id}">×</button></td></tr>`}).join('')||'<tr><td colspan=6 style="text-align:center">No transactions</td></tr>';
  document.querySelectorAll('.del').forEach(b=>b.onclick=()=>{state.txs=state.txs.filter(t=>t.id!==b.dataset.id);save();render()});
}
function exportCSV(){
  const head='date,type,category,amount_ngn,amount_usd,fx_used,note\n';
  const body=state.txs.map(t=>`${t.date},${t.type},"${t.category}",${txNGN(t)},${ngnToUsd(txNGN(t)).toFixed(2)},${t.fxUsed||fx()},"${(t.note||'').replace(/"/g,'""')}"`).join('\n');
  dl(new Blob([head+body],{type:'text/csv'}),'josh-'+state.settings.trackMonth+'.csv');
}
function dl(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click()}
function backupJSON(){state.syncMeta.lastBackup=new Date().toISOString();localStorage.setItem(dataKey(currentUser),JSON.stringify(state));dl(new Blob([JSON.stringify(state,null,2)],{type:'application/json'}),'josh-backup-'+currentUser+'-'+todayStr()+'.json');renderSyncMeta();toast('Backup downloaded ✓')}
function restoreObj(o){if(!o.settings||!o.txs)throw 0;state=o;if(!state.fxHistory)state.fxHistory=[...SEED_FX_2026];if(!state.syncMeta)state.syncMeta={};save();fillSettings();renderBudgets();render();toast('Restored ✓')}
function renderSyncMeta(){if(!$('syncMeta')||!state)return;const m=state.syncMeta||{};$('syncMeta').textContent='Last backup: '+(m.lastBackup||'never')+' • Last sync: '+(m.lastSync||'—')}

// ---------- PDF ----------
function generatePDF(){
  const {jsPDF}=window.jspdf;const doc=new jsPDF();
  const s=state.settings,mtx=monthTx();
  const spent=mtx.filter(t=>t.type==='expense').reduce((a,t)=>a+txNGN(t),0);
  const incTx=mtx.filter(t=>t.type==='income').reduce((a,t)=>a+txNGN(t),0);
  const income=s.monthlyIncomeNGN+(s.extraIncomeNGN||0)+incTx;
  const remain=income-spent;
  doc.setFontSize(18);doc.setTextColor(20,30,80);doc.text('JOSH Finance — Monthly Report',14,16);
  doc.setFontSize(10);doc.setTextColor(0,0,0);
  doc.text(`User: ${currentUser}   Month: ${s.trackMonth}   Grade: ${s.gradeLabel}`,14,23);
  doc.text(`Income since Sept 2026: NGN ${s.monthlyIncomeNGN.toLocaleString()} / mo  (${fmtUSD(ngnToUsd(s.monthlyIncomeNGN))})`,14,28);
  doc.text(`FX: NGN ${fx().toLocaleString()} / $1  •  ${s.fxSource}  •  Updated: ${(s.fxUpdatedAt||'').slice(0,16)} UTC`,14,33);
  doc.text(`Generated: ${new Date().toLocaleString()}`,14,38);
  doc.autoTable({startY:42,head:[['Metric','NGN','USD']],body:[
    ['Total income',income.toLocaleString(),ngnToUsd(income).toFixed(2)],
    ['Spent MTD',spent.toLocaleString(),ngnToUsd(spent).toFixed(2)],
    ['Remaining',remain.toLocaleString(),ngnToUsd(remain).toFixed(2)],
    ['Status',remain>=0?'SURPLUS':'DEFICIT '+Math.abs(remain).toLocaleString(),remain>=0?'OK':'OVER'],
  ]});
  const byCat={};mtx.filter(t=>t.type==='expense').forEach(t=>byCat[t.category]=(byCat[t.category]||0)+txNGN(t));
  doc.autoTable({startY:doc.lastAutoTable.finalY+8,head:[['Category','NGN','USD','%']],body:Object.keys(byCat).map(c=>[c,byCat[c].toLocaleString(),ngnToUsd(byCat[c]).toFixed(2),spent?Math.round(byCat[c]/spent*100)+'%':'—'])});
  doc.autoTable({startY:doc.lastAutoTable.finalY+8,head:[['Date','Type','Category','NGN','USD','Note']],body:mtx.map(t=>[t.date,t.type,t.category,txNGN(t).toLocaleString(),ngnToUsd(txNGN(t)).toFixed(2),(t.note||'').slice(0,40)])});
  const y=doc.lastAutoTable.finalY+8;
  doc.setFontSize(9);doc.text('All $ values at live rate NGN '+fx().toLocaleString()+'/$1. Sept: 50,000 Dangote + 30,000 Transport.',14,y);
  doc.save(`JOSH-Report-${s.trackMonth}.pdf`);toast('PDF downloaded ✓');
}

// ---------- init ----------
document.addEventListener('DOMContentLoaded',()=>{
  $('authPass').addEventListener('input',updatePwMeter);
  $('showPass').onclick=()=>{
    const p=$('authPass'),show=p.type==='password';
    p.type=show?'text':'password';
    $('eyeOpen').classList.toggle('hidden',show);
    $('eyeShut').classList.toggle('hidden',!show);
    $('showPass').setAttribute('aria-label',show?'Hide password':'Show password');
  };
  // random sample username as placeholder (changes every load)
  try{
    const handles=['kudi_king7','naira_ninja','vault_fox42','kobo_queen','ledger_lion','sapa_no_more','money_maven','zafin_up','cowry_collector','mint_master9'];
    $('authUser').placeholder='e.g. '+handles[Math.floor(Math.random()*handles.length)];
  }catch{}
  buildMoneyRain();buildTicker();
  // bind auth actions FIRST so login/register can never be blocked by later init errors
  $('loginBtn').onclick=doLogin;$('registerBtn').onclick=doRegister;
  $('approvalOk').onclick=hideApprovalModal;
  $('authPass').addEventListener('keydown',e=>{if(e.key==='Enter')doLogin()});
  $('authUser').addEventListener('keydown',e=>{if(e.key==='Enter')doLogin()});
  $('logoutBtn').onclick=async()=>{try{await sb?.auth.signOut()}catch{};localStorage.removeItem(SESSION_KEY);location.reload()};
  try{setupHint()}catch(e){console.warn('setupHint',e)}
  const sess=getSession();
  if(sess){try{currentUser=sess.u;state=loadUser(sess.u)||seedForUser();$('authOverlay').classList.add('hidden');$('userBadge').textContent=sess.u;$('syncUser').textContent=sess.u;$('roleBadge').textContent=(getUsers()[sess.u]?.role==='superadmin'?'👑 superadmin':'user');$('sessInfo').textContent=sessLeft()}catch(e){console.warn('session restore',e)}}
  if(state){fillSettings();setTxType('expense');renderBudgets();initSupabaseFromStore();renderAdmin();render();fetchLiveFX()}
  restoreCloudSession(); // silent auto-connect + resume Supabase login on any device
  $('adminRefresh').onclick=()=>{refreshAdminList();toast('Queue refreshed')};
  $('adminPullCloud').onclick=pullCloudQueue;
  $('adminBell').onclick=()=>document.getElementById('adminCard').scrollIntoView({behavior:'smooth'});
  $('saveSettings').onclick=saveSettings;$('addTx').onclick=addTx;
  $('tabExpense').onclick=()=>setTxType('expense');$('tabIncome').onclick=()=>setTxType('income');
  $('monthlyIncomeNGN').oninput=updatePeeks;$('fxRate').oninput=updatePeeks;
  $('fxRate').onchange=()=>{state.settings.fxRate=parseFloat($('fxRate').value)||fx();state.settings.fxSource='manual override';save();render()};
  $('fxRefresh').onclick=()=>fetchLiveFX();$('fxRange').onchange=()=>renderFX();
  $('txAmountNGN').addEventListener('input',()=>{const v=parseFloat($('txAmountNGN').value)||0;$('txPeek').textContent=v?`≈ ${fmtUSD(ngnToUsd(v))} at ₦${Math.round(fx()).toLocaleString()}/$ (live)`:''});
  document.querySelectorAll('#currencySeg button').forEach(b=>b.onclick=()=>{displayCur=b.dataset.cur;document.querySelectorAll('#currencySeg button').forEach(x=>x.classList.remove('active'));b.classList.add('active');render()});
  $('exportBtn').onclick=exportCSV;$('backupBtn').onclick=backupJSON;
  $('restoreFile').onchange=e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=()=>{try{restoreObj(JSON.parse(r.result))}catch{toast('Bad backup file')}};r.readAsText(f)};
  $('copySync').onclick=async()=>{const code=btoa(unescape(encodeURIComponent(JSON.stringify(state))));$('syncArea').value=code;try{await navigator.clipboard.writeText(code);toast('Sync code copied ✓')}catch{toast('Code ready — copy manually')}};
  $('pasteSync').onclick=()=>{try{restoreObj(JSON.parse(decodeURIComponent(escape(atob($('syncArea').value.trim())))))}catch{toast('Invalid sync code')}};
  $('sbConnect').onclick=()=>connectSupabase(false);$('sbPush').onclick=sbPush;$('sbPull').onclick=sbPull;
  $('syncBtn').onclick=()=>document.getElementById('syncCard').scrollIntoView({behavior:'smooth'});
  $('resetBtn').onclick=()=>{if(confirm('Clear this user data?')){state=seedForUser();localStorage.setItem(dataKey(currentUser),JSON.stringify(state));fillSettings();renderBudgets();render()}};
  $('txSearch').oninput=renderTxTable;$('txFilter').onchange=renderTxTable;
  $('importCsv').onchange=e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=()=>{const ls=r.result.split('\n').slice(1);ls.forEach(l=>{const p=l.split(',');if(p[0]&&p[3]){const n=parseFloat(p[3])||0;state.txs.push({id:uid(),type:'expense',date:p[0].trim(),category:'Other',amountNGN:n,amountUSD:+(n/fx()).toFixed(2),fxUsed:fx(),note:'csv import'})}});save();render()};r.readAsText(f)};
  $('pdfBtn').onclick=generatePDF;$('pdfBtn2').onclick=generatePDF;
  $('runForecast').onclick=renderIncomeForecast;$('fcYears').onchange=renderIncomeForecast;$('fcCur').onchange=renderIncomeForecast;
  window.addEventListener('storage',e=>{
    if(e.key===dataKey(currentUser)){state=loadUser(currentUser);render()}
    if(e.key===USERS_KEY||e.key==='joshPendingPing'){
      setupHint();
      if(isSuperadmin()){
        const before=$('pendingCount').textContent;
        refreshAdminList();
        if($('pendingCount').textContent!==before&&document.hidden===false) toast('🔔 New registration awaiting approval');
      }
    }
  });
  setInterval(()=>{const t=todayStr();if(state&&!state.fxHistory.find(h=>h.date===t))fetchLiveFX()},6*3600*1000);
  setInterval(()=>{if(currentUser)$('sessInfo').textContent=sessLeft()},60000);
  setInterval(()=>{if(isSuperadmin()&&sbConnected)pullCloudQueueSilent()},90000);
  renderSyncMeta();
});
async function pullCloudQueueSilent(){try{
  const {data}=await sb.from('user_approvals').select('user_name,role,status').eq('status','pending');
  if(!data)return;const users=getUsers();let changed=false;
  data.forEach(r=>{if(!users[r.user_name]){users[r.user_name]={role:r.role||'user',status:'pending',created:new Date().toISOString(),failed:0,lockUntil:0,cloudOnly:true,salt:'',iter:PBKDF2_ITER,hash:''};changed=true}});
  if(changed){setUsers(users);refreshAdminList();toast('🔔 New cloud registration pending')}
}catch{}}
