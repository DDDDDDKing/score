import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.8/+esm';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './config.js';

export const configured = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);
export const db = configured ? createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
}) : null;
export const byId = id => document.getElementById(id);
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, x => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
export const fmt = n => n == null || Number.isNaN(Number(n)) ? '—' : Number(n).toFixed(2);
export const groupName = g => ({undergraduate:'本科生评委', graduate:'研究生评委'}[g] || g);
export const laneName = g => ({growth:'成长赛道', employment:'就业赛道'}[g] || g);
export const typeName = g => ({product:'产品研发',production:'生产服务',marketing:'市场营销',general:'通用职能',public:'公共服务'}[g] || '');
export const rubric = c => c.lane === 'growth' ? [
  ['goal','职业目标',20],['action','行动成果',40],['alignment','目标契合度',30],['intent','实习意向',10]
] : [
  ['general','通用素质',['product','production'].includes(c.employment_type) ? 35:45],
  ['awareness','岗位认知程度',['product','production'].includes(c.employment_type) ? 20:15],
  ['competency','岗位胜任能力',['product','production'].includes(c.employment_type) ? 25:20],
  ['potential','发展潜力',10],['intent','录用意向',10]
];
export const friendly = err => {
  const msg = err?.message || String(err || '未知错误');
  if (/Failed to fetch|NetworkError/i.test(msg)) return '网络连接失败，请检查校园网、移动网络或 Supabase 服务状态';
  return msg;
};
let timer;
export function toast(message, isError=false){
 const el=byId('toast'); if(!el) return;
 el.textContent=message; el.className='toast show'+(isError?' error':'');
 clearTimeout(timer);timer=setTimeout(()=>el.className='toast',5000);
}
export function downloadCSV(filename, rows){
 const csv='\uFEFF'+rows.map(row=>row.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(',')).join('\r\n');
 const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);
}
export async function rpc(name,args={}){
 const {data,error}=await db.rpc(name,args);if(error) throw error;return data;
}