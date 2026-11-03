import {db,configured,byId,escapeHtml,fmt,groupName,laneName,typeName,rubric,friendly,toast,rpc} from './shared.js';
const TOKEN_KEY='xy_career_judge_token_v1';
let token=localStorage.getItem(TOKEN_KEY), candidates=[], submitted=new Map(), activeLane='growth', open=false, current=null;

function switchPanel(active){byId('loginPanel').hidden=active;byId('appPanel').hidden=!active;}
async function syncEvent(){
 const settings=await rpc('cv_public_settings');open=Boolean(settings?.[0]?.voting_open);
 byId('eventTitle').textContent=settings?.[0]?.title || '中南大学第十二届大学生职业规划大赛 · 初赛';
 byId('openStatus').textContent=open?' · 评分通道已开放':' · 当前暂停评分';
 candidates=await rpc('cv_public_contestants')||[];
}
async function refreshSubmissions(){
 const own=await rpc('cv_my_scores',{p_token:token});
 submitted=new Map((own||[]).map(s=>[s.contestant_id,s]));
 byId('progressNo').textContent=`${submitted.size}/${candidates.length}`;
 renderList();
}
function renderList(){
 document.querySelectorAll('.lane-tab').forEach(el=>el.classList.toggle('selected',el.dataset.lane===activeLane));
 const filtered=candidates.filter(c=>c.lane===activeLane);
 const el=byId('contestantList');
 if(!filtered.length){el.innerHTML='<div class="panel empty">本赛道暂未添加参赛选手</div>';return;}
 el.innerHTML=filtered.map((c,i)=>{
  const done=submitted.get(c.id);
  return `<article class="candidate-card"><div class="candidate-no">${String(c.display_order).padStart(2,'0')}</div><div class="candidate-main"><h3>${escapeHtml(c.name)}</h3><p>${laneName(c.lane)}${c.employment_type?' · '+typeName(c.employment_type):''}</p></div><div class="candidate-actions">${done?`<span class="done-tag">✓ 已评分 ${fmt(done.total)}</span>`:`<button class="btn small outline" data-score="${c.id}" ${!open?'disabled':''}>开始评分</button>`}</div></article>`;
 }).join('');
 el.querySelectorAll('[data-score]').forEach(button=>button.addEventListener('click',()=>openDialog(button.dataset.score)));
}
function openDialog(id){
 current=candidates.find(c=>c.id===id);
 if(!current||submitted.has(id)||!open){toast('当前无法为该选手评分',true);return;}
 byId('scoreTitle').textContent=current.name;
 byId('scoreSubtitle').textContent=laneName(current.lane)+(current.employment_type?' · '+typeName(current.employment_type):'');
 byId('rubricFields').innerHTML=rubric(current).map(([key,label,max])=>`<label class="rubric-row"><div><span>${escapeHtml(label)}</span><small>最高 ${max} 分</small></div><input name="${key}" type="number" inputmode="decimal" min="0" max="${max}" step="0.5" placeholder="0–${max}" required></label>`).join('');
 byId('totalPreview').innerHTML='0.0 <small>/ 100</small>';
 byId('scoreDialog').showModal();
}
function calcTotal(){
 let sum=0;for(const el of byId('rubricFields').querySelectorAll('input')) sum+=Number(el.value)||0;
 byId('totalPreview').innerHTML=`${sum.toFixed(1)} <small>/ 100</small>`;
}
async function activate(e){
 e.preventDefault();if(!configured) return;
 const name=byId('judgeName').value.trim(), id=byId('studentId').value.trim(), phone=byId('judgePhone').value.trim();
 if(!name||!id||!phone) return;
 const btn=byId('claimBtn');btn.disabled=true;btn.textContent='正在核验身份…';
 try{
  const rows=await rpc('cv_claim_judge',{p_name:name,p_student_id:id,p_phone:phone});
  if(!rows?.length) throw Error('登录失败，请联系管理员');
  token=rows[0].session_token;localStorage.setItem(TOKEN_KEY,token);
  await enter();toast('登录成功，已恢复云端评分进度');
 }catch(err){toast(friendly(err),true)}finally{btn.disabled=false;btn.innerHTML='验证身份并登录 <span>→</span>'}
}
async function enter(){
 const who=await rpc('cv_whoami',{p_token:token});
 if(!who?.length){
   // 不自动删除旧设备标记：误清理浏览器存储会导致身份丢失，需管理员处理。
   switchPanel(false);throw Error('此浏览器的评委凭证已失效。请重新输入姓名、学号和电话号码登录');
 }
 byId('greeting').textContent=who[0].judge_name;
 byId('groupTag').textContent=groupName(who[0].judge_group);
 switchPanel(true);await refreshSubmissions();
}
async function submitScore(e){
 e.preventDefault();if(!current) return;
 const breakdown={};for(const [key,,max] of rubric(current)){
  const field=byId('scoreForm').elements.namedItem(key);const n=Number(field.value);
  if(field.value===''||!Number.isFinite(n)||n<0||n>max||n*2!==Math.round(n*2)){toast('请完整填写各项分数，精确到 0.5 分',true);return;}
  breakdown[key]=n;
 }
 const total=Object.values(breakdown).reduce((a,b)=>a+b,0);
 if(!confirm(`确定提交 ${current.name} 的评分 ${total.toFixed(1)} 分？\n提交后不能自行修改。`))return;
 const btn=byId('submitScore');btn.disabled=true;btn.textContent='提交中…';
 try{await rpc('cv_submit_score',{p_token:token,p_contestant_id:current.id,p_breakdown:breakdown});
  byId('scoreDialog').close();await refreshSubmissions();toast('评分已保存至云端');
 }catch(err){toast(friendly(err),true);await refreshSubmissions().catch(()=>{});}finally{btn.disabled=false;btn.textContent='确认并提交评分';}
}
async function init(){
 if(!configured){byId('setupNotice').hidden=false;byId('claimBtn').disabled=true;return;}
 try{await syncEvent();if(token)await enter();}catch(err){toast(friendly(err),true);}
}
byId('claimForm').addEventListener('submit',activate);
byId('scoreForm').addEventListener('submit',submitScore);
byId('closeScore').addEventListener('click',()=>byId('scoreDialog').close());
byId('rubricFields').addEventListener('input',calcTotal);
document.querySelectorAll('.lane-tab').forEach(el=>el.addEventListener('click',()=>{activeLane=el.dataset.lane;renderList()}));
init();
setInterval(async()=>{if(document.visibilityState==='visible'&&configured&&!byId('scoreDialog').open){try{await syncEvent();if(token&&!byId('appPanel').hidden)await refreshSubmissions();}catch{}}},15000);
