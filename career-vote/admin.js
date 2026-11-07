import {db,configured,byId,escapeHtml,fmt,laneName,typeName,friendly,toast,downloadCSV} from './shared.js?v=20261108-cn';
let state={judges:[],contestants:[],scores:[],settings:null}, busy=false, activeTab='overview', detailId=null;
const get=(table)=>db.from(table);
const testContestantId='62bf246b-a421-4bb1-9c53-ed8383b0e7fb';
const bulkButtons=document.querySelectorAll('[data-bulk-judges],[data-bulk-contestants]');
let pendingReload;
async function fetchAll(table){
 const all=[];let from=0;while(true){
  const {data,error}=await get(table).select('*').order('id').range(from,from+999);
  if(error)throw error;all.push(...data);if(data.length<1000)break;from+=1000;
  if(from>100000)throw Error('记录数量超出单次导出上限');
 }return all;
}
async function assertAdmin(){
 const {data:{user},error}=await db.auth.getUser();if(error||!user)return false;
 const {data,error:permissionError}=await get('cv_admins').select('user_id').eq('user_id',user.id).maybeSingle();
 if(permissionError)throw permissionError;return Boolean(data);
}
async function setLoggedIn(){
 if(!(await assertAdmin())){
  await db.auth.signOut();throw Error('管理权限尚未开通，请联系主办方');
 }
 byId('authPanel').hidden=true;byId('adminPanel').hidden=false;
 await reload();
}
async function login(event){
 event.preventDefault();if(!configured)return;const btn=byId('loginBtn');btn.disabled=true;
 try{
  const {error}=await db.auth.signInWithPassword({email:'event-admin@career-vote.invalid',password:byId('password').value});
  if(error)throw error;await setLoggedIn();toast('管理员登录成功');
 }catch(e){toast(friendly(e),true)}finally{btn.disabled=false}
}
async function reload(silent=false){
 if(busy)return pendingReload;
 if(!configured||byId('adminPanel').hidden)return;
 busy=true;
 pendingReload=loadAdminData(silent);
 return pendingReload;
}
async function loadAdminData(silent){
 try{
  const [settings,judges,contestants,scores]=await Promise.all([
    get('cv_settings').select('*').eq('id',1).single(),fetchAll('cv_judges'),fetchAll('cv_contestants'),fetchAll('cv_scores')
  ]);
  if(settings.error)throw settings.error;
  state={settings:settings.data,judges:judges.filter(j=>j.judge_group==='undergraduate'),contestants,scores};render();
  byId('lastSync').textContent='上次更新：'+new Date().toLocaleTimeString('zh-CN');
  if(!silent)toast('最新数据已同步');
 }catch(err){toast(friendly(err),true)}finally{busy=false}
}
function votesFor(id){return state.scores.filter(s=>s.contestant_id===id && state.judges.some(j=>j.id===s.judge_id&&j.is_active));}
function stats(c){
 const votes=votesFor(c.id);
 const average=votes.length ? votes.reduce((sum,score)=>sum+Number(score.total),0)/votes.length : null;
 return {average,submitted:votes.length,eligible:state.judges.filter(j=>j.is_active).length};
}
function render(){
 byId('adminTitle').textContent=state.settings.title;
 renderOverview();renderJudges();renderContestants();renderResults();if(detailId)showDetails(detailId,false);renderSettings();
}
function renderOverview(){
 const js=state.judges,active=js.filter(j=>j.is_active),acted=active.filter(j=>j.activated_at);
 const visible=state.contestants.filter(c=>c.visible);
 const s=visible.flatMap(c=>votesFor(c.id));
 const items=[['登记评委',js.length,`启用 ${active.length} 人`],
  ['已激活评委',acted.length,`${active.length?Math.round(acted.length/active.length*100):0}% 已激活`],
  ['参赛选手',visible.length,'当前显示'],
  ['完成评分次数',s.length,`理论满额 ${active.length*state.contestants.filter(c=>c.visible).length} 次`]];
 byId('statsGrid').innerHTML=items.map(([n,v,h])=>`<div class="stat"><label>${n}</label><div class="kpi">${v}</div><div class="hint">${h}</div></div>`).join('');
 const total=active.length*state.contestants.filter(c=>c.visible).length,pct=total?Math.min(100,s.length/total*100):0;
 byId('overallProgress').innerHTML=`<div class="progress-line">${s.length} / ${total} 份已提交 <small>${pct.toFixed(1)}% 完成</small></div><div class="progress-track"><div style="width:${pct}%"></div></div><p class="small-note">仅统计当前有效评委与可见选手的评分；每位评委对每位选手最多提交一次。</p>`;
}
function renderJudges(){
 const query=byId('judgeSearch').value.trim().toLowerCase();
 const relevant=state.judges.filter(j=>(!query||(j.name+' '+j.student_id+' '+j.phone).toLowerCase().includes(query)));
 byId('judgeSummary').textContent=`共 ${state.judges.length} 人，启用 ${state.judges.filter(j=>j.is_active).length} 人`;
 byId('judgeTable').innerHTML=relevant.map(j=>{
  const count=state.scores.filter(s=>s.judge_id===j.id).length;
  return `<tr><td><strong>${escapeHtml(j.name)}</strong></td><td class="nowrap">${escapeHtml(j.student_id)}</td><td>${escapeHtml(j.phone)}</td><td><span class="status ${j.activated_at?'yes':'no'}">${j.activated_at?'已激活':'未激活'}</span></td><td>${count}</td><td><span class="status ${j.is_active?'yes':'no'}">${j.is_active?'启用':'停用'}</span></td><td class="nowrap"><button class="btn outline small" data-toggle-judge="${j.id}">${j.is_active?'停用':'启用'}</button>${j.activated_at?`<button class="btn outline small" data-reset-judge="${j.id}">重置登录</button>`:`<button class="btn outline small" data-remove-judge="${j.id}">删除</button>`}</td></tr>`;
 }).join('') || '<tr><td colspan="7">暂无记录</td></tr>';
 byId('judgeTable').querySelectorAll('[data-toggle-judge]').forEach(el=>el.onclick=()=>toggleJudge(el.dataset.toggleJudge));
 byId('judgeTable').querySelectorAll('[data-reset-judge]').forEach(el=>el.onclick=()=>resetJudge(el.dataset.resetJudge));
 byId('judgeTable').querySelectorAll('[data-remove-judge]').forEach(el=>el.onclick=()=>removeJudge(el.dataset.removeJudge));
}
function renderContestants(){
 byId('contestantTable').innerHTML=[...state.contestants].sort((a,b)=>a.display_order-b.display_order).map(c=>
  `<tr><td>${c.display_order}</td><td><strong>${escapeHtml(c.name)}</strong></td><td>${laneName(c.lane)}${c.employment_type?' / '+typeName(c.employment_type):''}</td><td><span class="status ${c.visible?'yes':'no'}">${c.visible?'显示':'隐藏'}</span></td><td class="nowrap"><button class="btn outline small" data-toggle-c="${c.id}">${c.visible?'隐藏':'显示'}</button><button class="danger-link" data-delete-c="${c.id}">删除</button></td></tr>`
 ).join('')||'<tr><td colspan="5">暂无选手</td></tr>';
 byId('contestantTable').querySelectorAll('[data-toggle-c]').forEach(el=>el.onclick=()=>toggleContestant(el.dataset.toggleC));
 byId('contestantTable').querySelectorAll('[data-delete-c]').forEach(el=>el.onclick=()=>deleteContestant(el.dataset.deleteC));
}
function ranked(){
 return state.contestants.filter(c=>c.visible).map(c=>({c,...stats(c)}))
  .sort((a,b)=>a.c.lane.localeCompare(b.c.lane)||(b.average??-1)-(a.average??-1)||a.c.display_order-b.c.display_order);
}
function renderResults(){
 const lane=byId('resultLane').value;
 const rows=ranked().filter(r=>lane==='all'||r.c.lane===lane);
 let previousLane='',rank=0;
 byId('resultTable').innerHTML=rows.map(r=>{
  if(r.c.lane!==previousLane){previousLane=r.c.lane;rank=0;}
  if(r.average!==null)rank++;
  return `<tr><td class="rank">${r.average===null?'—':rank}</td><td><strong>${escapeHtml(r.c.name)}</strong><div class="small-note">${laneName(r.c.lane)}</div></td><td class="positive">${fmt(r.average)}</td><td>${r.submitted} / ${r.eligible}</td><td><button class="btn outline small" data-detail="${r.c.id}">查看</button></td></tr>`;
 }).join('')||'<tr><td colspan="5">暂无成绩</td></tr>';
 byId('resultTable').querySelectorAll('[data-detail]').forEach(el=>el.onclick=()=>showDetails(el.dataset.detail));
}
function showDetails(id,scroll=true){
 detailId=id;
 const candidate=state.contestants.find(c=>c.id===id);if(!candidate)return;
 byId('resultDetails').hidden=false;byId('detailTitle').textContent=candidate.name+' · 评分明细';
 byId('detailTable').innerHTML=state.scores.filter(s=>s.contestant_id===id).map(s=>{
  const j=state.judges.find(x=>x.id===s.judge_id);return `<tr><td>${escapeHtml(j?.name||'已删除')}</td><td>${escapeHtml(j?.student_id||'')}</td><td>${j?.is_active?'计入均分':'不计入均分'}</td><td>${fmt(s.total)}</td><td>${new Date(s.created_at).toLocaleString('zh-CN')}</td><td><button class="danger-link" data-delete-score="${s.id}">撤销该次评分</button></td></tr>`;
 }).join('')||'<tr><td colspan="6">暂无评分</td></tr>';
 byId('detailTable').querySelectorAll('[data-delete-score]').forEach(el=>el.onclick=()=>deleteScore(el.dataset.deleteScore,id));
 if(scroll)byId('resultDetails').scrollIntoView({behavior:'smooth',block:'nearest'});
}
function renderSettings(){
 const s=state.settings;byId('settingTitle').value=s.title;
 byId('votingOpen').checked=s.voting_open;
}
async function mutate(promise,success='操作成功'){
 try{const {error}=await promise;if(error)throw error;await reload(true);toast(success);}catch(e){toast(friendly(e),true)}
}
async function setAllStatuses(button){
 const judges=button.hasAttribute('data-bulk-judges');
 const enabled=(judges?button.dataset.bulkJudges:button.dataset.bulkContestants)==='true';
 const action=judges?(enabled?'启用':'停用'):(enabled?'显示':'隐藏');
 const target=judges?'大众评委':'正式选手';
 const note=judges&&!enabled?' 停用后，这些评委的历史评分将暂不计入均分。':'';
 if(!confirm(`确定${action}全部${target}？${note}`))return;

 bulkButtons.forEach(el=>el.disabled=true);
 try{
  const update=judges
   ? get('cv_judges').update({is_active:enabled}).eq('judge_group','undergraduate').neq('is_active',enabled)
   : get('cv_contestants').update({visible:enabled}).neq('id',testContestantId).neq('visible',enabled);
  const {error}=await update;
  if(error)throw error;
  if(busy)await pendingReload;
  await reload(true);
  toast(`已${action}全部${target}`);
 }catch(error){toast(friendly(error),true)}
 finally{bulkButtons.forEach(el=>el.disabled=false)}
}
async function addJudge(e){
 e.preventDefault();const name=byId('addJudgeName').value.trim(),student_id=byId('addJudgeId').value.trim(),phone=byId('addJudgePhone').value.trim();
 if(!name||!student_id||!phone)return;
 await mutate(get('cv_judges').insert({name,student_id,phone,judge_group:'undergraduate'}),'评委已添加');
 byId('addJudgeForm').reset();
}
async function toggleJudge(id){const j=state.judges.find(x=>x.id===id);if(!j)return;
 if(!confirm(`确定${j.is_active?'停用':'启用'} ${j.name}？${j.is_active?'停用后此评委评分暂不参与统计。':''}`))return;
 await mutate(get('cv_judges').update({is_active:!j.is_active}).eq('id',id),'评委状态已更新');
}
async function resetJudge(id){const j=state.judges.find(x=>x.id===id);
 if(!j||!confirm(`确定重置 ${j.name} 的登录凭证？\n所有已登录浏览器将失效；历史打分仍保留，已评分的选手不能再评分。`))return;
 await mutate(get('cv_judges').update({activated_at:null,token_hash:null}).eq('id',id),'已解除绑定，允许重新登录');
}
async function removeJudge(id){const j=state.judges.find(x=>x.id===id);
 if(!j||j.activated_at||state.scores.some(s=>s.judge_id===id)){toast('已激活或已有评分的评委不能直接删除，请先停用',true);return;}
 if(!confirm(`确定删除未激活评委 ${j.name}？`))return;
 await mutate(get('cv_judges').delete().eq('id',id),'评委已删除');
}
async function addContestant(e){
 e.preventDefault();const lane=byId('contestantLane').value;
 const item={name:byId('contestantName').value.trim(),lane,employment_type:lane==='employment'?byId('employmentType').value:null,display_order:Number(byId('displayOrder').value)||0};
 if(!item.name)return;
 await mutate(get('cv_contestants').insert(item),'选手已添加');byId('addContestantForm').reset();byId('employmentTypeWrap').hidden=true;
}
async function toggleContestant(id){const c=state.contestants.find(x=>x.id===id);if(!c)return;
 if(!confirm(`确定${c.visible?'隐藏':'显示'}选手 ${c.name}？`))return;
 await mutate(get('cv_contestants').update({visible:!c.visible}).eq('id',id));
}
async function deleteContestant(id){const c=state.contestants.find(x=>x.id===id);if(!c)return;
 if(state.scores.some(s=>s.contestant_id===id)){toast('已有评分记录的选手不能删除，建议将其隐藏',true);return;}
 if(!confirm(`确定删除未评分选手 ${c.name}？`))return;
 await mutate(get('cv_contestants').delete().eq('id',id),'选手已删除');
}
async function deleteScore(id,contestantId){const s=state.scores.find(x=>x.id===id);if(!s)return;
 if(!confirm(`确认撤销 ${fmt(s.total)} 分这条评分？\n评委可对此选手重新提交一次分数。操作不可撤销。`))return;
 await mutate(get('cv_scores').delete().eq('id',id),'该次评分已撤销');showDetails(contestantId);
}
async function saveSettings(e){
 e.preventDefault();
 const next={title:byId('settingTitle').value.trim(),voting_open:byId('votingOpen').checked,updated_at:new Date().toISOString()};
 if(!next.title){toast('赛事名称不能为空',true);return;}
 if(next.voting_open&&!state.settings.voting_open&&!confirm('确定开放大众评分？请先确认名单与选手正确。'))return;
 await mutate(get('cv_settings').update(next).eq('id',1),'赛事设置已保存');
}
async function readSheet(file,sheetName){
 if(!file)throw Error('请先选择 Excel 文件');
 const name=file.name.toLowerCase();
 if(name.endsWith('.csv')){
  if(!window.XLSX)throw Error('Excel 解析组件未加载，请检查网络');
  const contents=await file.arrayBuffer(),book=window.XLSX.read(contents,{type:'array'});
  return window.XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]],{defval:'',raw:false});
 }
 if(!window.XLSX)throw Error('Excel 解析组件未加载，请检查网络');
 const book=window.XLSX.read(await file.arrayBuffer(),{type:'array',cellText:true});
 const sheet=book.Sheets[sheetName];if(!sheet)throw Error(`Excel 中没有「${sheetName}」工作表，请使用提供的模板`);
 return window.XLSX.utils.sheet_to_json(sheet,{defval:'',raw:false});
}
async function importJudges(){
 const file=byId('judgesExcel').files[0],label='本科生评委';
 try{
  const items=(await readSheet(file,label)).map(x=>({name:String(x['姓名']??'').trim(),student_id:String(x['学号']??'').trim(),phone:String(x['电话号码']??'').trim(),judge_group:'undergraduate'})).filter(x=>x.name||x.student_id);
  if(!items.length)throw Error(`${label}工作表内没有数据`);
  for(const j of items)if(!j.name||j.student_id.length<3||!/^\+?[0-9]{6,20}$/.test(j.phone))throw Error(`存在空姓名、无效学号或电话号码：${j.name} / ${j.student_id}`);
  const ids=items.map(j=>j.student_id);if(new Set(ids).size!==ids.length)throw Error('Excel 表内存在重复学号，请先检查');
  const existing=new Map(state.judges.map(j=>[j.student_id,j]));const duplicates=items.filter(j=>existing.has(j.student_id));
  const conflicts=duplicates.filter(j=>{const old=existing.get(j.student_id);return old.name!==j.name||old.phone!==j.phone;});
  if(conflicts.length)throw Error(`已有 ${conflicts.length} 条同学号但姓名或电话不同，请先人工核查：${conflicts.slice(0,4).map(j=>j.student_id).join('、')}`);
  const fresh=items.filter(j=>!existing.has(j.student_id));
  if(!confirm(`${label}：表格 ${items.length} 人，其中已存在 ${duplicates.length} 人，新增 ${fresh.length} 人。\n确认批量导入？`))return;
  for(let i=0;i<fresh.length;i+=200){const {error}=await get('cv_judges').insert(fresh.slice(i,i+200));if(error)throw error;}
  await reload(true);byId('judgeImportInfo').textContent=`本次新导入 ${fresh.length} 人；跳过已存在 ${duplicates.length} 人`;
  toast(`导入成功：新增 ${fresh.length} 名 ${label}`);
 }catch(e){toast(friendly(e),true)}
}
async function importContestants(){
 try{
  const items=(await readSheet(byId('contestantsExcel').files[0],'参赛选手')).filter(x=>x['姓名']).map(x=>{
   const lane=String(x['赛道']??'').trim()==='成长赛道'?'growth':String(x['赛道']??'').trim()==='就业赛道'?'employment':null;
   const mapping={'产品研发':'product','生产服务':'production','市场营销':'marketing','通用职能':'general','公共服务':'public'};
   const et=lane==='employment'?mapping[String(x['就业类别']??'').trim()]:null;
   if(!lane||(lane==='employment'&&!et))throw Error('参赛选手表包含无效赛道/就业类别');
   return {name:String(x['姓名']).trim(),lane,employment_type:et,display_order:Number(x['展示顺序'])||0};
  });
  if(!items.length)throw Error('参赛选手工作表为空');
  const existing=new Set(state.contestants.map(c=>`${c.lane}|${c.name}`));
  const seen=new Set();for(const c of items){const k=`${c.lane}|${c.name}`;if(existing.has(k)||seen.has(k))throw Error(`选手重名或已存在：${c.name}（${laneName(c.lane)}）`);seen.add(k);}
  if(!confirm(`确定新增 ${items.length} 名参赛选手？`))return;
  for(let i=0;i<items.length;i+=100){const {error}=await get('cv_contestants').insert(items.slice(i,i+100));if(error)throw error;}
  await reload(true);toast(`成功导入 ${items.length} 名选手`);
 }catch(e){toast(friendly(e),true)}
}
function exportResults(){
 const headers=['赛道','姓名','平均分（满分100）','有效提交人数','启用评委人数'];
 const rows=ranked().map(r=>[laneName(r.c.lane),r.c.name,r.average,r.submitted,r.eligible]);
 downloadCSV('大赛成绩汇总.csv',[headers,...rows]);
}
function exportDetails(){
 const rows=ranked().flatMap(({c})=>state.scores.filter(s=>s.contestant_id===c.id).map(s=>{
  const judge=state.judges.find(j=>j.id===s.judge_id);
  return [laneName(c.lane),c.name,judge?.name||'',judge?.student_id||'',s.total,JSON.stringify(s.breakdown),s.created_at,judge?.is_active?'计入均分':'不计入均分'];
 }));
 downloadCSV('大赛评分明细.csv',[['赛道','参赛选手','评委姓名','学号','总分','分项评分','提交时间','统计状态'],...rows]);
}
function showTab(tab){activeTab=tab;
 document.querySelectorAll('.admin-tabs button').forEach(el=>el.classList.toggle('selected',el.dataset.tab===tab));
 document.querySelectorAll('.tab-section').forEach(el=>el.hidden=el.id!==`tab-${tab}`);
 if(tab==='results')reload(true);
}
async function init(){
 if(!configured){byId('configWarning').hidden=false;byId('loginBtn').disabled=true;return;}
 try{const {data:{session}}=await db.auth.getSession();if(session)await setLoggedIn();}catch(err){toast(friendly(err),true)}
}
bulkButtons.forEach(button=>button.addEventListener('click',()=>setAllStatuses(button)));
byId('authForm').addEventListener('submit',login);
byId('refreshBtn').addEventListener('click',()=>reload());
byId('signOutBtn').addEventListener('click',async()=>{await db.auth.signOut();byId('adminPanel').hidden=true;byId('authPanel').hidden=false;toast('已安全退出')});
document.querySelectorAll('.admin-tabs button').forEach(el=>el.addEventListener('click',()=>showTab(el.dataset.tab)));
byId('addJudgeForm').addEventListener('submit',addJudge);
byId('judgeSearch').addEventListener('input',renderJudges);
byId('importJudgeBtn').addEventListener('click',importJudges);
byId('addContestantForm').addEventListener('submit',addContestant);
byId('contestantLane').addEventListener('change',()=>byId('employmentTypeWrap').hidden=byId('contestantLane').value!=='employment');
byId('importContestantBtn').addEventListener('click',importContestants);
byId('resultLane').addEventListener('change',renderResults);
byId('hideDetails').addEventListener('click',()=>{detailId=null;byId('resultDetails').hidden=true});
byId('exportResults').addEventListener('click',exportResults);
byId('exportDetails').addEventListener('click',exportDetails);
byId('settingsForm').addEventListener('submit',saveSettings);
setInterval(()=>{if(!byId('adminPanel').hidden&&document.visibilityState==='visible'&&activeTab!=='settings'&&activeTab!=='contestants')reload(true)},3000);
init();