import {db,configured,byId,escapeHtml,fmt,groupName,laneName,typeName,rubric,friendly,toast} from './shared.js';
const TOKEN_KEY='xy_career_judge_token_v1';
let token=null;try{token=localStorage.getItem(TOKEN_KEY)}catch{}
let candidates=[], submitted=new Map(), activeLane='growth', open=false, current=null, pendingScore=null, submitting=false, refreshing=false, returnFocus=null;
async function rpc(name,args={},timeoutMs=25000){
 const controller=typeof AbortController==='function'?new AbortController():null;let timer;
 const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{reject(Error('网络连接超时，请检查网络后重试；已保存的评分不会重复提交。'));if(controller)controller.abort()},timeoutMs)});
 const request=(async()=>{let query=db.rpc(name,args);if(controller)query=query.abortSignal(controller.signal);const {data,error}=await query;if(error)throw error;return data})();
 try{return await Promise.race([request,deadline])}finally{clearTimeout(timer)}
}
function switchPanel(active){byId('loginPanel').hidden=active;byId('appPanel').hidden=!active;}
async function syncEvent(){
 const settings=await rpc('cv_public_settings');open=Boolean(settings?.[0]?.voting_open);
 byId('eventTitle').textContent=settings?.[0]?.title || '中南大学第十二届大学生职业规划大赛 · 湘雅医学院院赛';
 byId('openStatus').textContent=open?' · 评分通道已开放':' · 当前暂停评分';
 candidates=await rpc('cv_public_contestants')||[];
}
function updateProgress(){byId('progressNo').textContent=`${submitted.size}/${candidates.length}`;renderList()}
async function refreshSubmissions(){
 const own=await rpc('cv_my_scores',{p_token:token});
 submitted=new Map((own||[]).map(s=>[s.contestant_id,s]));updateProgress();
}
function renderList(){
 document.querySelectorAll('.lane-tab').forEach(el=>el.classList.toggle('selected',el.dataset.lane===activeLane));
 const filtered=candidates.filter(c=>c.lane===activeLane),el=byId('contestantList');
 if(!filtered.length){el.innerHTML='<div class="panel empty">本赛道暂未添加参赛选手</div>';return;}
 el.innerHTML=filtered.map(c=>{
  const done=submitted.get(c.id);
  return `<article class="candidate-card"><div class="candidate-no">${String(c.display_order).padStart(2,'0')}</div><div class="candidate-main"><h3>${escapeHtml(c.name)}</h3><p>${laneName(c.lane)}${c.employment_type?' · '+typeName(c.employment_type):''}</p></div><div class="candidate-actions">${done?`<span class="done-tag">✓ 已评分 ${fmt(done.total)}</span>`:`<button class="btn small outline" data-score="${c.id}" ${!open?'disabled':''}>开始评分</button>`}</div></article>`;
 }).join('');
 el.querySelectorAll('[data-score]').forEach(button=>button.addEventListener('click',()=>openDialog(button.dataset.score)));
}
function sizeScoreOverlay(){
 if(!byId('scoreDialog').hidden){const height=window.visualViewport?window.visualViewport.height:window.innerHeight;byId('scoreDialog').style.setProperty('--score-vh',`${height}px`)}
}
function scoreError(message=''){
 const el=byId('scoreError');el.textContent=message;el.hidden=!message;
}
function editScore(){
 if(submitting)return;pendingScore=null;
 byId('scoreEdit').hidden=false;byId('scoreConfirm').hidden=true;
 byId('prepareScore').hidden=false;byId('submitScore').hidden=true;byId('editScore').hidden=true;
 byId('scoreStep').textContent='填写分项评分';scoreError();
}
function openDialog(id){
 current=candidates.find(c=>c.id===id);
 if(!current||submitted.has(id)||!open){toast('当前无法为该选手评分',true);return;}
 returnFocus=document.activeElement;
 byId('scoreTitle').textContent=current.name;
 byId('scoreSubtitle').textContent=laneName(current.lane)+(current.employment_type?' · '+typeName(current.employment_type):'');
 // Text inputs avoid inconsistent number/step validation in mobile WebViews.
 byId('rubricFields').innerHTML=rubric(current).map(([key,label,max])=>`<label class="rubric-row"><div><span>${escapeHtml(label)}</span><small>最高 ${max} 分 · 以0.5分为单位</small></div><input name="${key}" type="text" inputmode="decimal" autocomplete="off" enterkeyhint="next" maxlength="8" placeholder="0–${max}" aria-label="${escapeHtml(label)}，最高${max}分"></label>`).join('');
 byId('totalPreview').innerHTML='0.0 <small>/ 100</small>';editScore();
 byId('scoreDialog').hidden=false;document.body.classList.add('score-modal-open');sizeScoreOverlay();
 byId('scoreTitle').focus();
}
function closeScoreDialog(){
 if(submitting)return;
 byId('scoreDialog').hidden=true;document.body.classList.remove('score-modal-open');pendingScore=null;
 if(returnFocus&&returnFocus.isConnected)returnFocus.focus();
}
function readNumber(value){
 const clean=String(value).trim().replace(/[０-９]/g,c=>String(c.charCodeAt(0)-0xff10)).replace(/[．。，,]/g,'.');
 return /^(?:\d+(?:\.\d*)?|\.\d+)$/.test(clean)?Number(clean):NaN;
}
function calcTotal(){
 let sum=0;for(const el of byId('rubricFields').querySelectorAll('input')){const n=readNumber(el.value);if(Number.isFinite(n))sum+=n;el.removeAttribute('aria-invalid')}
 byId('totalPreview').innerHTML=`${sum.toFixed(1)} <small>/ 100</small>`;scoreError();
}
function prepareScore(e){
 e.preventDefault();if(!current||submitting)return;
 const breakdown={};for(const [key,label,max] of rubric(current)){
  const field=byId('scoreForm').elements.namedItem(key),n=readNumber(field.value);
  if(!Number.isFinite(n)||n<0||n>max||n*2!==Math.round(n*2)){
   field.setAttribute('aria-invalid','true');scoreError(`请检查「${label}」：填写0至${max}分，最小间隔为0.5分。`);field.focus();return;
  }
  breakdown[key]=n;
 }
 pendingScore={id:current.id,name:current.name,breakdown,total:Object.values(breakdown).reduce((a,b)=>a+b,0)};
 if(document.activeElement&&typeof document.activeElement.blur==='function')document.activeElement.blur();
 byId('confirmBreakdown').innerHTML=rubric(current).map(([key,label])=>`<div class="confirm-score-row"><span>${escapeHtml(label)}</span><strong>${fmt(breakdown[key])} 分</strong></div>`).join('');
 byId('confirmTotal').textContent=pendingScore.total.toFixed(1);
 byId('scoreEdit').hidden=true;byId('scoreConfirm').hidden=false;
 byId('prepareScore').hidden=true;byId('submitScore').hidden=false;byId('editScore').hidden=false;
 byId('scoreStep').textContent='请核对后确认提交';scoreError();sizeScoreOverlay();byId('submitScore').focus();
}
async function activate(e){
 e.preventDefault();if(!configured)return;
 const name=byId('judgeName').value.trim(),id=byId('studentId').value.trim(),phone=byId('judgePhone').value.trim();if(!name||!id||!phone)return;
 const btn=byId('claimBtn');btn.disabled=true;btn.textContent='正在核验身份…';
 try{
  const rows=await rpc('cv_claim_judge',{p_name:name,p_student_id:id,p_phone:phone});if(!rows?.length)throw Error('登录失败，请联系管理员');
  token=rows[0].session_token;try{localStorage.setItem(TOKEN_KEY,token)}catch{}
  await enter();toast('登录成功，已恢复云端评分进度');
 }catch(err){toast(friendly(err),true)}finally{btn.disabled=false;btn.innerHTML='验证身份并登录 <span>→</span>'}
}
async function enter(){
 const who=await rpc('cv_whoami',{p_token:token});
 if(!who?.length){switchPanel(false);throw Error('此浏览器的评委凭证已失效。请重新输入姓名、学号和电话号码登录')}
 byId('greeting').textContent=who[0].judge_name;byId('groupTag').textContent=groupName(who[0].judge_group);
 switchPanel(true);await refreshSubmissions();
}
function markSaved(score){
 submitted.set(score.id,{contestant_id:score.id,total:score.total,created_at:new Date().toISOString()});updateProgress();
 submitting=false;closeScoreDialog();toast('评分已保存至云端');
}
async function submitScore(){
 if(!pendingScore||submitting)return;
 const score=pendingScore;submitting=true;
 const btn=byId('submitScore');btn.disabled=true;btn.textContent='正在保存，请稍候…';byId('editScore').disabled=true;byId('closeScore').disabled=true;scoreError();
 try{
  await rpc('cv_submit_score',{p_token:token,p_contestant_id:score.id,p_breakdown:score.breakdown});
  markSaved(score);
 }catch(err){
  // A timed-out response may already have committed. Read before offering a retry.
  let stored=false;try{await refreshSubmissions();stored=submitted.has(score.id)}catch{}
  if(stored){submitting=false;closeScoreDialog();toast('已核实：评分已保存至云端，无需重复提交')}
  else scoreError(`${friendly(err)} 分数已保留在此页面，可重新点击确认提交；如仍失败，请截图并在QQ群1058687856反馈。`);
 }finally{
  submitting=false;btn.disabled=false;btn.textContent='确认提交并锁定评分';byId('editScore').disabled=false;byId('closeScore').disabled=false;
 }
}
async function init(){
 if(!configured){byId('setupNotice').hidden=false;byId('claimBtn').disabled=true;return;}
 try{await syncEvent();if(token)await enter()}catch(err){toast(friendly(err),true)}finally{byId('claimBtn').disabled=false;byId('claimBtn').innerHTML='验证身份并登录 <span>→</span>'}
}
byId('claimForm').addEventListener('submit',activate);
byId('scoreForm').addEventListener('submit',prepareScore);
byId('submitScore').addEventListener('click',submitScore);
byId('editScore').addEventListener('click',editScore);
byId('closeScore').addEventListener('click',closeScoreDialog);
byId('rubricFields').addEventListener('input',calcTotal);
byId('scoreDialog').addEventListener('keydown',e=>{
 if(e.key==='Escape'){e.preventDefault();closeScoreDialog()}
 if(e.key==='Tab'){
  const nodes=[...byId('scoreDialog').querySelectorAll('button,input,[tabindex="0"]')].filter(el=>!el.disabled&&el.getClientRects().length);
  if(!nodes.length)return;const first=nodes[0],last=nodes[nodes.length-1];
  if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}
  else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}
 }
});
window.addEventListener('resize',sizeScoreOverlay);if(window.visualViewport)window.visualViewport.addEventListener('resize',sizeScoreOverlay);
document.querySelectorAll('.lane-tab').forEach(el=>el.addEventListener('click',()=>{activeLane=el.dataset.lane;renderList()}));
init();
setInterval(async()=>{if(document.visibilityState==='visible'&&configured&&byId('scoreDialog').hidden&&!refreshing){refreshing=true;try{await syncEvent();if(token&&!byId('appPanel').hidden)await refreshSubmissions()}catch{}finally{refreshing=false}}},15000);
