document.querySelectorAll('[data-copy-qq]').forEach(button=>button.addEventListener('click',async()=>{
 try{await navigator.clipboard.writeText(button.dataset.copyQq);button.textContent='群号已复制 ✓';}catch{button.textContent='QQ群：'+button.dataset.copyQq;}
 const note=document.getElementById('toast');if(note){note.textContent='反馈QQ群：1058687856';note.className='toast show';setTimeout(()=>note.className='toast',4000);}
}));
