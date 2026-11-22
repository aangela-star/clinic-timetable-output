window.startCalendarEditor=function(editorConfig){
'use strict';
const preview=editorConfig?.preview===true;
const subscriptions=[];function listen(type,fn){window.addEventListener(type,fn);subscriptions.push([type,fn])}
const M=TimetableModelV2,P=TimetablePosterV2,V=TimetableView,D=CalendarDraft,META=TEST_DATA,KEY='clinic-timetable.calendar-integrated-draft.v1';
const $=id=>document.getElementById(id);let state=M.init(META),currentMonth=ScheduleSaveLoadCore.resolveCalendarBootMonth(window,{metaMonth:META.month}),view={template:'calendar',format:'dual',clinicId:META.clinics[0].id},editing=null,dirty=false,eventDirty=false,newDoctorDirty=false,lastRaw=null,readFailed=false;let doctorEditors=[],cellEditors=[],rotationEditors=[];let visibleClinic=META.clinics[0].id;
const errors={INVALID_COLOR:'色碼必須是 # 加六位十六進位字元。',INVALID_NAME:'醫師姓名不可空白，最長20字。',DOCTOR_REQUIRED:'請選醫師。',ORIGINAL_MISMATCH:'原醫師與新的日班基準不符，請明確選擇。',SLOT_CONFLICT:'同日同院同診有衝突；未儲存任何變更。',UNKNOWN_SCHEDULE:'此日班尚未排定或未確認。',DOCTOR_IN_USE:'醫師仍被某月班表或事件使用，不可移除。',MONTH_EXISTS:'月份已存在，未覆寫。',ROTATION_ONLY_SATURDAY:'按日期輪診只適用週六。'};
function report(s){$('status').textContent=s;if($('save-result'))$('save-result').textContent=s}function error(e){report(errors[e.code]||e.message)}
try{lastRaw=localStorage.getItem(KEY);if(lastRaw){const old=JSON.parse(lastRaw);state=M.validateState(old.state,META);if(old.view)view=V.setView(view,old.view,META);if(old.currentMonth&&M.month(state,old.currentMonth))currentMonth=old.currentMonth;report('已讀取原本同鍵的本機草稿，沒有改名或遷移資料。')}else report('目前載入內建來源，未讀到已存草稿。若曾填過，請先核對是否同檔案路徑／同來源，不要以新內建資料覆蓋舊檔。')}catch(e){readFailed=true;report('原草稿讀取或驗證失敗；不覆寫。請先保留備份或匯入有效草稿，本頁輸入仍可保留。')}
// The boot month may be this device's real current month, which M.init only seeds for META.month.
// Materialise it from the fixed source baseline so a fresh device opens the same month as every
// other device instead of silently falling back to the built-in 2026-10 copy. Existing months are
// never replaced, so nothing already drafted or loaded is lost.
if(!M.month(state,currentMonth)){try{state=M.createSourceMonth(state,currentMonth,META)}catch(_){currentMonth=META.month}}
function markDirty(){dirty=true;updateDirty()}
function updateDirty(){$('draft-state').textContent=dirty?'有尚未儲存的輸入；預覽／列印仍是上次儲存內容。請按總儲存。':'目前沒有未儲存輸入。儲存僅在本機，不是雲端送出或發布。';$('draft-state').classList.toggle('blocked',dirty);$('print-test').disabled=dirty||Boolean($('poster').dataset.fatal==='true')}
function watch(e,kind){for(const n of ['input','change'])e.addEventListener(n,()=>{if(kind==='event')eventDirty=true;if(kind==='new-doctor')newDoctorDirty=true;markDirty()})}
function options(e,items,value){e.replaceChildren();items.forEach(([v,t])=>e.add(new Option(t,v)));if(items.some(([v])=>v===value))e.value=value}
function opts(){return state.doctors.map(d=>[d.id,d.name])}
function contrast(c){const v=M.colorInfo(c);return '白底對比 '+v.contrast.toFixed(2)+':1'+(v.lowContrast?'｜不足4.5:1，請留意姓名可讀性':'｜對比足夠')}
function collectBatch(){const batch={doctors:doctorEditors.map(e=>e.read()),cells:cellEditors.map(e=>e.read()),rotations:rotationEditors.map(e=>e.read())};if(newDoctorDirty){const name=$('new-doctor-name').value.trim();if(!name)throw Error('新增醫師尚未填姓名；請補齊或按清空新增欄位。');batch.newDoctor={id:'doctor-'+crypto.randomUUID(),name,color:$('new-doctor-color').value}}if(eventDirty){const date=$('date').value;if(M.dateInfo(date).month!==currentMonth)throw Error('異動日期與編輯月份不同。');if($('type').value!=='add'&&!$('original').value)throw Error('請明確選原醫師，或取消未儲存異動編輯。');batch.event={id:editing||'event-'+crypto.randomUUID(),date,clinicId:$('clinic').value,slot:$('slot').value,type:$('type').value,originalDoctorId:$('type').value==='add'?null:$('original').value,doctorId:$('type').value==='cancel'?null:$('doctor').value}}return batch}
function saveAll(action={}){let committed=false;try{if(readFailed)throw Error('原草稿未能安全讀取，禁止覆寫；請先匯出本頁輸入備份或匯入有效版本。');const batch={...collectBatch(),...action};const next=D.applyBatch(state,currentMonth,META,M,batch);const raw=D.write(localStorage,KEY,lastRaw,{state:next,currentMonth,view});state=next;lastRaw=raw;committed=true;dirty=false;eventDirty=false;newDoctorDirty=false;editing=null;$('doctor').value='';$('original').value='';$('new-doctor-name').value='';$('new-doctor-color').value='#215f70';const targetMonth=$('new-month').value;refreshAll();$('new-month').value=targetMonth;report('已儲存全部目前輸入到本機草稿，並更新預覽。沒有雲端送出或正式發布。');return true}catch(e){if(committed){$('print-test').disabled=true;report('本機草稿已儲存，但預覽更新失敗；請保留備份後再檢查：'+e.message);return true}markDirty();report('儲存失敗，未寫入草稿；所有畫面輸入保留。'+(errors[e.code]||e.message));return false}}
function guardSwitch(){if(!dirty)return true;report('切換已取消：請先按「儲存本機草稿／更新預覽」。所有未儲存輸入仍留在原處。');return false}
function showDoctors(){doctorEditors=[];const host=$('doctor-settings');host.replaceChildren();state.doctors.forEach(d=>{const box=document.createElement('div');box.className='doctor-setting';const name=document.createElement('input');name.value=d.name;name.maxLength=20;name.setAttribute('aria-label','醫師姓名 '+d.id);const color=document.createElement('input');color.type='color';color.value=d.color;const code=document.createElement('input');code.value=d.color;const note=document.createElement('small');note.textContent=contrast(d.color);watch(name);watch(color);watch(code);color.addEventListener('input',()=>{code.value=color.value;note.textContent=contrast(code.value)});code.addEventListener('input',()=>{try{color.value=M.colorInfo(code.value).color;note.textContent=contrast(code.value)}catch(e){note.textContent=errors.INVALID_COLOR}});const id=document.createElement('small');id.textContent='ID：'+d.id;const save=document.createElement('button');save.type='button';save.textContent='儲存全部變更';save.addEventListener('click',()=>saveAll());const remove=document.createElement('button');remove.type='button';remove.textContent='移除醫師並儲存全部';remove.addEventListener('click',()=>saveAll({removeDoctor:d.id}));box.append(name,color,code,note,id,save,remove);host.append(box);doctorEditors.push({read:()=>({id:d.id,name:name.value,color:code.value})})})}
function showBaseline(){cellEditors=[];const host=$('baseline-grid'),cid=visibleClinic;host.replaceChildren();const corner=document.createElement('div');corner.textContent='診次';host.append(corner);META.days.forEach(t=>{const e=document.createElement('strong');e.textContent=t;host.append(e)});META.slots.forEach((slot,i)=>{const label=document.createElement('strong');label.textContent=slot[1];host.append(label);META.days.forEach((day,d)=>{const current=state.months[currentMonth].clinics[cid][d][i],box=document.createElement('div');box.className='baseline-cell';const status=document.createElement('select');options(status,[['scheduled','有醫師'],['no-doctor','當時段無醫師'],['rotation','週六逐日輪診'],['unconfirmed','未設定／待確認'],['closed','本診次明確休診']],current.status);watch(status);const people=document.createElement('div'),checks=[];state.doctors.forEach(doc=>{const l=document.createElement('label'),c=document.createElement('input');c.type='checkbox';c.value=doc.id;c.checked=current.doctorIds.includes(doc.id);watch(c);l.append(c,document.createTextNode(doc.name));people.append(l);checks.push(c)});const enable=()=>checks.forEach(c=>c.disabled=status.value!=='scheduled');status.addEventListener('change',enable);enable();const save=document.createElement('button');save.type='button';save.textContent='儲存全部';save.addEventListener('click',()=>saveAll());box.append(status,people,save);host.append(box);const m=currentMonth;cellEditors.push({read:()=>({month:m,clinicId:cid,day:d,slot:slot[0],cell:{status:status.value,doctorIds:status.value==='scheduled'?checks.filter(c=>c.checked).map(c=>c.value):[]}})})})})}
function showRotations(){rotationEditors=[];const host=$('rotation-schedule'),cid=visibleClinic;host.replaceChildren();const slots=META.slots.filter((s,i)=>state.months[currentMonth].clinics[cid][5][i].status==='rotation');if(!slots.length){host.textContent='此院本月無週六輪診格。';return}for(const slot of slots)for(const date of M.saturdayDates(currentMonth)){const old=state.months[currentMonth].rotations.find(r=>r.clinicId===cid&&r.date===date&&r.slot===slot[0])||{status:'unannounced',doctorIds:[]};const row=document.createElement('div');row.className='rotation-row';const label=document.createElement('strong');label.textContent=date+'（週六）'+slot[1];const status=document.createElement('select');options(status,[['unannounced','未公布'],['scheduled','已排定'],['no-doctor','當時段無醫師']],old.status);watch(status);const people=document.createElement('div'),checks=[];state.doctors.forEach(doc=>{const l=document.createElement('label'),c=document.createElement('input');c.type='checkbox';c.value=doc.id;c.checked=old.doctorIds.includes(doc.id);watch(c);l.append(c,document.createTextNode(doc.name));people.append(l);checks.push(c)});const enable=()=>checks.forEach(c=>c.disabled=status.value!=='scheduled');status.addEventListener('change',enable);enable();const save=document.createElement('button');save.type='button';save.textContent='儲存全部';save.addEventListener('click',()=>saveAll());row.append(label,status,people,save);host.append(row);rotationEditors.push({read:()=>({clinicId:cid,date,slot:slot[0],status:status.value,doctorIds:status.value==='scheduled'?checks.filter(c=>c.checked).map(c=>c.value):[]})})}}
function syncEvent(){const selected=$('doctor').value;options($('doctor'),[['','請選醫師'],...opts()],selected);$('doctor').disabled=$('type').value==='cancel';let b,info;try{info=M.dateInfo($('date').value);b=M.dailyBase(state,$('clinic').value,$('date').value,$('slot').value,META);$('date-info').textContent=info.month+' '+(META.days[info.weekday]||'週日')+(b.status==='unannounced'?'｜未公布':!b.known?'｜未確認':'')}catch(e){$('date-info').textContent='請選有效日期'}const prior=$('original').value;let items=$('type').value==='add'?[['','加診不取代原醫師']]:b?.known?b.doctorIds.map(id=>[id,M.doctor(state,id).name]):[];if(items.length>1||editing&&!items.some(([id])=>id===prior))items.unshift(['','請明確選原醫師']);if(!items.length)items=[['',b?.known?'無固定醫師':'未排定／未確認']];options($('original'),items,prior);$('original').disabled=$('type').value==='add'||!b?.known||!b.doctorIds.length;$('apply').disabled=false}
function drawPoster(){context();const r=V.render(state,currentMonth,META,M,P,view),print=V.renderPrint(state,currentMonth,META,M,P,view);$('poster').className=r.classes;$('poster').dataset.fatal=String(r.fatal);$('clinics').innerHTML=r.clinics;$('print-host').innerHTML=print.clinics;$('paper-rule').textContent='@page{size:'+print.paper+';margin:10mm}';document.body.className=view.format==='dual'?'print-dual':'print-a4';$('top-clinic').value=view.topClinicId||META.clinics[0].id;$('top-clinic').disabled=view.format!=='dual';$('format').value=view.format;$('template').value='calendar';$('print-clinic').value=view.clinicId;$('print-clinic').disabled=view.format==='dual';$('print-test').textContent=view.format==='dual'?'列印／存PDF：雙院A4直式一頁':'列印／存PDF：單院A4橫式';$('format-note').textContent=view.format==='dual'?'雙院 A4 直式同一頁兩院：姓名約'+print.namePt.toFixed(1)+'pt、異動'+print.eventPt.toFixed(1)+'pt、日期'+print.datePt.toFixed(1)+'pt。字較小，僅適合近距總覽；櫃台閱讀建議單院A4橫式。':'單院 A4 橫式：姓名約'+print.namePt.toFixed(1)+'pt、異動'+print.eventPt.toFixed(1)+'pt、日期'+print.datePt.toFixed(1)+'pt。';const banner=$('incomplete'),notice=r.complete?'':(r.fatal?'有衝突／超出容量，請處理後列印。':'可列印標記草稿；含未公布／待確認，不代表完整正式公告。')+'\n'+r.warnings.join('\n');banner.textContent=notice;banner.hidden=!notice;$('event-list').replaceChildren();for(const e of state.months[currentMonth].events){const row=document.createElement('li'),text=document.createElement('span'),issue=M.eventIssue(state,currentMonth,e,META);text.textContent=(issue?'【待處理】':'')+e.date+' '+e.clinicId+' '+e.slot+' '+(e.originalDoctorId?M.doctor(state,e.originalDoctorId).name:'新增')+' → '+(e.type==='cancel'?'停診':M.doctor(state,e.doctorId).name+(e.type==='add'?'加診':'代診'));row.append(text);for(const [label,fn] of [['編輯',()=>{if(!guardSwitch())return;editing=e.id;$('clinic').value=e.clinicId;$('date').value=e.date;$('slot').value=e.slot;$('type').value=e.type;syncEvent();$('original').value=e.originalDoctorId||'';$('doctor').value=e.doctorId||'';eventDirty=false;report('編輯事件；修改後請按總儲存。')}],['刪除並儲存全部',()=>saveAll({removeEvent:e.id})]]){const b=document.createElement('button');b.type='button';b.textContent=label;b.addEventListener('click',fn);row.append(b)}$('event-list').append(row)}updateDirty()}
function refreshAll(){options($('month'),Object.keys(state.months).sort().map(m=>[m,m]),currentMonth);$('new-month').value=currentMonth;$('baseline-month').textContent=currentMonth;showDoctors();showBaseline();showRotations();syncEvent();drawPoster();$('answer').textContent='資料更新後請重新解析。'}
options($('baseline-clinic'),META.clinics.map(c=>[c.id,c.name]),visibleClinic);options($('clinic'),META.clinics.map(c=>[c.id,c.name]));options($('slot'),META.slots.map(s=>[s[0],s[1]]));options($('top-clinic'),META.clinics.map(c=>[c.id,c.name]),view.topClinicId||META.clinics[0].id);options($('print-clinic'),META.clinics.map(c=>[c.id,c.name]),view.clinicId);$('date').value=currentMonth+'-07';
$('save-all').addEventListener('click',()=>saveAll());$('month').addEventListener('change',()=>{const target=$('month').value;if(!guardSwitch()){$('month').value=currentMonth;return}currentMonth=target;editing=null;$('date').value=currentMonth+'-07';refreshAll();report('已切換月份；原月草稿未刪除。')});$('baseline-clinic').addEventListener('change',()=>{if(!guardSwitch()){$('baseline-clinic').value=visibleClinic;return}visibleClinic=$('baseline-clinic').value;showBaseline();showRotations()});
for(const id of ['format','print-clinic','top-clinic'])$(id).addEventListener('change',()=>{if(!guardSwitch()){$('format').value=view.format;$('print-clinic').value=view.clinicId;$('top-clinic').value=view.topClinicId||META.clinics[0].id;return}try{const next=V.setView(view,{format:$('format').value,clinicId:$('print-clinic').value,topClinicId:$('top-clinic').value},META);if(readFailed)throw Error('原草稿讀取失敗，不能覆寫。');lastRaw=D.write(localStorage,KEY,lastRaw,{state,currentMonth,view:next});view=next;drawPoster()}catch(e){drawPoster();error(e)}});
for(const id of ['clinic','date','slot','type'])$(id).addEventListener('change',()=>{eventDirty=true;markDirty();$('original').value='';syncEvent()});for(const id of ['doctor','original'])watch($(id),'event');for(const id of ['new-doctor-name','new-doctor-color'])watch($(id),'new-doctor');$('clear-new-doctor').addEventListener('click',()=>{$('new-doctor-name').value='';$('new-doctor-color').value='#215f70';newDoctorDirty=false;markDirty()});$('add-doctor').textContent='儲存全部（含新增醫師）';$('add-doctor').addEventListener('click',()=>saveAll());$('event-form').addEventListener('submit',e=>{e.preventDefault();eventDirty=true;saveAll()});$('reset').textContent='取消未儲存異動編輯';$('reset').addEventListener('click',()=>{editing=null;eventDirty=false;$('doctor').value='';$('original').value='';syncEvent();markDirty();report('已取消異動表單編輯；其他欄位仍保留，請按總儲存。')});
for(const [id,create] of [['create-month',M.createMonth],['create-source-month',M.createSourceMonth]])$(id).addEventListener('click',()=>{if(!guardSwitch())return;try{if(readFailed)throw Error('原草稿讀取失敗，禁止覆寫；請先匯入有效備份。');const m=$('new-month').value,next=create(state,m,META);lastRaw=D.write(localStorage,KEY,lastRaw,{state:next,currentMonth:m,view});state=next;currentMonth=m;editing=null;$('date').value=m+'-07';refreshAll();report('已建立另一月本機草稿，不複製舊輪診人選。')}catch(e){error(e)}});
$('print-test').addEventListener('click',()=>{if(dirty){report('請先按總儲存，避免列印舊預覽。');return}const r=V.renderPrint(state,currentMonth,META,M,P,view);if(!r.printable){report('存在衝突或超量資料，不能視為完整海報，請先處理。');return}window.print()});$('query').addEventListener('click',()=>{try{$('answer').textContent=(dirty?'注意：此結果來自上次已儲存資料，尚未包含畫面未存輸入。\n':'')+JSON.stringify(M.resolveDay(state,META,$('clinic').value,$('date').value,$('slot').value),null,2)}catch(e){error(e)}});
function downloadBackup(){try{const next=D.applyBatch(state,currentMonth,META,M,collectBatch());const blob=new Blob([JSON.stringify({state:next,currentMonth,view},null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='calendar-local-draft-'+currentMonth+'.json';a.click();URL.revokeObjectURL(url);report('已下載本機草稿備份，包含可驗證的目前輸入；不代表已儲存到瀏覽器。')}catch(e){error(e)}}$('export-draft').addEventListener('click',downloadBackup);$('import-draft').addEventListener('change',async()=>{if(!guardSwitch()){$('import-draft').value='';return}try{const file=$('import-draft').files[0];if(!file)return;const obj=JSON.parse(await file.text()),next=M.validateState(obj.state,META),m=obj.currentMonth;if(!M.month(next,m))throw Error('備份月份不存在。');const v=V.setView(view,obj.view||{},META);const current=localStorage.getItem(KEY);lastRaw=D.write(localStorage,KEY,current,{state:next,currentMonth:m,view:v});state=next;currentMonth=m;view=v;readFailed=false;eventDirty=false;editing=null;$('date').value=m+'-07';refreshAll();report('已匯入有效本機備份；未對外送出。')}catch(e){error(e)}finally{$('import-draft').value=''}});
listen('beforeprint',()=>{const r=V.renderPrint(state,currentMonth,META,M,P,view);if(dirty||!r.printable)$('print-host').innerHTML='<div style="padding:20mm;font-size:18pt;color:#922f37">有未儲存輸入或資料衝突，請取消列印，先儲存及處理後再試。</div>'});listen('afterprint',drawPoster);
listen('beforeunload',e=>{if(dirty||busy){e.preventDefault();e.returnValue=''}});refreshAll();


const cloudPanel=document.createElement('section');cloudPanel.id='cloud-panel';cloudPanel.className='savebar';
cloudPanel.innerHTML='<label>雲端月份 <input id="cloud-month" type="month"></label><button id="cloud-load">載入雲端月份</button><button id="cloud-save">儲存目前月份到雲端</button><button id="download-png">下載高清 PNG</button><p id="cloud-status" role="status">尚未讀取雲端。首次儲存前會核對並備份該月份。</p>';
document.querySelector('.editor').prepend(cloudPanel);$('cloud-month').value=currentMonth;
const manual=document.createElement('div');manual.id='manual-publish';document.querySelector('.controls').append(manual);
var manualRoot=null,ManualSection=null,closed=false;
function context(){if(!manualRoot||!ManualSection)return;const clinicId=view.format==='dual'?(view.topClinicId||META.clinics[0].id):view.clinicId;manualRoot.render(React.createElement(ManualSection,{clinicName:META.clinics.find(c=>c.id===clinicId).name,monthKey:currentMonth,posterTitle:(Number(currentMonth.slice(0,4))-1911)+'年'+Number(currentMonth.slice(5))+'月'}))}
import('./manual-publish.mjs').then(mod=>{if(closed)return;ManualSection=mod.default;manualRoot=ReactDOM.createRoot(manual);context()}).catch(()=>{manual.textContent='手動發布說明暫時無法載入，請重新開啟或使用舊版入口。尚未發布。'});
// `busy` means an OPERATOR-initiated cloud action is running: it blocks leaving the page, because
// leaving could lose work the operator asked for. The startup read is deliberately NOT `busy`:
// it is an automatic read that owns nothing, so it must never refuse navigation or raise the
// unsaved-work dialog. `bootBusy` keeps the two mutually exclusive without that side effect.
let busy=false,bootBusy=false,bootStarted=false,bootControl=null,bootTimer=null;const observed=new Map();
function cloudStatus(t){$('cloud-status').textContent=t}
function backupCloud(month,payload){const key='clinic-timetable.cloud-backup.'+month+'.'+crypto.randomUUID();localStorage.setItem(key,JSON.stringify(payload));return key}
// Classify cloud read failures so the operator can tell "offline", "logged out" and "the proxy
// returned a login page" apart. Previously any of these surfaced as a raw JSON parse error.
function cloudFail(code,message){const e=Error(message);e.code=code;return e}
// READ ONLY. 'loadReadOnly' is the Apps Script action that cannot create or modify anything; the
// proxy chooses it server-side and fails closed if the deployed backend does not confirm it, so
// this request can never fall back to the legacy 'load' action that can insert the Schedules
// sheet and write its header row. The action here is informational and matches what the proxy does.
async function remote(month,signal){const u=new URL(window.SCHEDULE_SAVE_LOAD_CONFIG.webAppUrl);u.searchParams.set('month',month);u.searchParams.set('action','loadReadOnly');
 let r;try{r=await fetch(u,{credentials:'same-origin',cache:'no-store',signal})}catch(_){throw signal&&signal.aborted?cloudFail('CLOUD_TIMEOUT','雲端讀取逾時，已停止等待'):cloudFail('CLOUD_OFFLINE','無法連線雲端（離線或網路被阻擋）')}
 if(r.status===401||r.status===403)throw cloudFail('CLOUD_UNAUTHORIZED','雲端未授權或登入已過期，請重新登入後再試');
 // An abort can land while the BODY is still streaming, which arrives here as an AbortError, not
 // as bad JSON. Reporting that as 「可能被登入頁攔截」 would send the operator to re-authenticate
 // for a plain timeout, so the abort is checked before the malformed-response wording is used.
 let p;try{p=await r.json()}catch(_){throw signal&&signal.aborted?cloudFail('CLOUD_TIMEOUT','雲端讀取逾時，已停止等待'):cloudFail('CLOUD_MALFORMED','雲端回應不是有效 JSON（可能被登入頁或代理攔截）')}
 if(!r.ok||p.ok!==true)throw cloudFail(p.error==='READ_ONLY_LOAD_UNSUPPORTED'||p.error==='READ_ONLY_LOAD_UNVERIFIED'?p.error:'CLOUD_ERROR',p.message||p.error||'雲端讀取失敗（HTTP '+r.status+'）');return p}
function fingerprint(p){return JSON.stringify([p.found,p.data||null,p.updatedAt||null])}
function envelope(){const snapshot={...structuredClone(state),months:{[currentMonth]:structuredClone(state.months[currentMonth])}};return {title:currentMonth,note:'月曆版；儲存不等於發布',clinics:structuredClone(META.clinics),calendarVersion:1,calendar:{state:snapshot,currentMonth,view}}}
async function cloudAction(load){if(preview){cloudStatus('預覽版免密碼：請使用本機草稿及 JSON 備份；如需跨設備，請按上方「雲端登入」。');return}if(busy)return;if(bootBusy){cloudStatus('開啟時的雲端讀取還在進行，請稍候再按。沒有送出任何資料。');return}if(!guardSwitch())return;busy=true;document.querySelector('.editor').inert=true;$('cloud-load').disabled=$('cloud-save').disabled=true;try{
 const month=load?$('cloud-month').value:currentMonth;if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('請選有效月份');
 cloudStatus('正在核對雲端月份…');const p=await remote(month);backupCloud(month,p);
 if(load){
  if(!p.found){observed.set(month,fingerprint(p));cloudStatus(month+' 尚無雲端資料；目前輸入未變更。');return}
  if(p.data?.calendarVersion!==1){cloudStatus('此月是舊版格式，原資料已在本機備份；請開「舊版資料編輯／PNG」載入及下載。未自動遷移或覆寫。');return}
  const incoming=p.data.calendar;if(incoming.currentMonth!==month||Object.keys(incoming.state.months).length!==1)throw Error('雲端月份資料不一致');
  const next=M.validateState(incoming.state,META);if(!M.month(next,month))throw Error('缺少月份');const v=V.setView(view,incoming.view,META);
  backupCloud('local-before-load',{state,currentMonth,view});const raw=D.write(localStorage,KEY,lastRaw,{state:next,currentMonth:month,view:v});state=next;currentMonth=month;view=v;lastRaw=raw;editing=null;eventDirty=false;$('date').value=month+'-07';refreshAll();observed.set(month,fingerprint(p));ScheduleSaveLoadCore.rememberLoadedMonth(window,month,p);context();cloudStatus('已載入 '+month+'；載入前草稿及雲端原資料已備份於本機。');
 }else{
  if(p.found&&p.data?.calendarVersion!==1)throw Error('雲端有舊版資料，禁止直接覆寫或自動遷移；請先使用舊版核對及備份。');
  if(p.found&&(!observed.has(month)||observed.get(month)!==fingerprint(p)))throw Error('雲端已有資料或被其他分頁更新；請備份目前草稿後重新載入比較，未覆寫。');
  const response=await fetch(window.SCHEDULE_SAVE_LOAD_CONFIG.webAppUrl,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'text/plain;charset=UTF-8'},body:JSON.stringify({action:'save',month,schemaVersion:1,data:envelope()})});const result=await response.json();if(!response.ok||!result.ok)throw Error(result.message||result.error||'雲端儲存失敗');
  observed.delete(month);ScheduleSaveLoadCore.rememberSavedMonth(window,month,result);cloudStatus('已儲存 '+month+' 到雲端，尚未發布。再次儲存前請重新載入，避免覆蓋其他編輯。');
 }
}catch(e){cloudStatus('操作停止；本機輸入保留：'+e.message)}finally{busy=false;document.querySelector('.editor').inert=false;$('cloud-load').disabled=$('cloud-save').disabled=false}}
$('cloud-load').addEventListener('click',()=>cloudAction(true));$('cloud-save').addEventListener('click',()=>cloudAction(false));
// stampDraft: an incomplete month must leave this page marked as a draft. The PNG is a file that
// gets forwarded, so it cannot rely on the on-screen banner the way the preview does.
$('download-png').addEventListener('click',async()=>{if(!guardSwitch())return;const r=V.render(state,currentMonth,META,M,P,{...view,template:'calendar',format:'dual'},{stampDraft:true});if(r.fatal){report('請先處理衝突／超量，再下載。');return}const b=$('download-png');b.disabled=true;try{await document.fonts.ready;const svg=new DOMParser().parseFromString(r.clinics,'image/svg+xml').documentElement;svg.setAttribute('width','1080');svg.setAttribute('height','1920');const url=URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)],{type:'image/svg+xml'}));try{const image=new Image();image.src=url;await image.decode();const canvas=document.createElement('canvas');canvas.width=2160;canvas.height=3840;const ctx=canvas.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,2160,3840);ctx.drawImage(image,0,0,2160,3840);const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(!blob)throw Error('PNG 產生失敗');const link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=currentMonth+'_'+(view.topClinicId==='yi'?'毅安在上':'晉安在上')+'_雙院門診表.png';link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);report('已下載 2160 × 3840 PNG，尚未發布。')}finally{URL.revokeObjectURL(url)}}catch(e){report('下載失敗：'+e.message)}finally{b.disabled=false}});

if(preview){for(const id of ['cloud-load','cloud-save','cloud-month'])$(id).disabled=true;cloudStatus('月曆預覽版免密碼：可編輯、儲存本機、備份 JSON、下載 PNG 及列印；如需跨設備，請按上方「雲端登入」。')}

// Startup cloud read. Authenticated editor only, never in preview, and strictly a READ: it issues
// no POST and never auto-saves, locally or remotely.
//   no local draft -> adopt the validated FOUND cloud month in memory, so a device that has never
//                     been used still opens the same content every other device sees.
//   local draft    -> keep every local input untouched and say a cloud version exists; loading and
//                     comparing stays an explicit operator decision via 「載入雲端月份」.
//   missing/failed -> say plainly which source is on screen. Never report success.
// The local DRAFT is never written here: with no draft there is nothing to overwrite and nothing to
// back up, and leaving lastRaw null keeps the normal conflict check intact on the first save. The
// one localStorage write that does happen on a successful adoption is
// ScheduleSaveLoadCore.rememberLoadedMonth(), which stores only the month pointer
// 'clinic-timetable.last-schedule-month' — no schedule content.
const BOOT_CLOUD_TIMEOUT_MS=15000;
async function bootCloudRead(){
 if(preview||busy||bootBusy||bootStarted||closed)return;
 bootStarted=true;
 const month=currentMonth,hadDraft=lastRaw!==null;
 const localSource=hadDraft?'本機草稿':'內建來源固定版（非雲端資料）';
 // Snapshot everything the apply step is allowed to assume. state and view are replaced by new
 // objects on every real mutation (save, import, month switch, view switch), so identity checks
 // detect any intervening edit. A late response must never clobber work done while it was in
 // flight; it defers to the operator instead.
 // `editing` is included so that opening an event for editing while the read is in flight also
 // makes the response stale. Unreachable today (adoption requires no draft, and a no-draft month
 // has no events to edit), so this is an invariant kept explicit rather than a live check.
 const guard={month,raw:lastRaw,state,view,editing};
 const control=new AbortController();bootControl=control;
 const timer=setTimeout(()=>control.abort(),BOOT_CLOUD_TIMEOUT_MS);bootTimer=timer;
 bootBusy=true;$('cloud-load').disabled=$('cloud-save').disabled=true;
 cloudStatus('開啟時正在讀取雲端 '+month+'…');
 try{
  const p=await remote(month,control.signal);if(closed)return;
  if(guard.month!==currentMonth||guard.raw!==lastRaw||guard.state!==state||guard.view!==view||guard.editing!==editing||dirty){
   cloudStatus('開啟時的雲端讀取已過期：等待期間本機已有編輯、儲存或月份／版面切換，因此未套用任何雲端資料，本機輸入完整保留。如需雲端版本請按「載入雲端月份」比對。');return}
  if(!p.found){cloudStatus('雲端目前沒有 '+month+' 資料。畫面顯示的是'+localSource+'，不是雲端內容。');return}
  if(p.data?.calendarVersion!==1){cloudStatus('雲端 '+month+' 是舊版格式，未自動遷移或覆寫。畫面顯示的是'+localSource+'，不是雲端內容。');return}
  if(hadDraft||dirty){cloudStatus('雲端已有 '+month+' 版本，但本機草稿已完整保留、未被覆蓋。請先備份，再按「載入雲端月份」比對後自行決定。目前畫面是'+localSource+'。');return}
  const incoming=p.data.calendar;
  if(!incoming||!incoming.state||incoming.currentMonth!==month||Object.keys(incoming.state.months).length!==1)throw cloudFail('CLOUD_MALFORMED','雲端月份資料不一致');
  const next=M.validateState(incoming.state,META);if(!M.month(next,month))throw cloudFail('CLOUD_MALFORMED','雲端資料缺少該月份');
  const v=V.setView(view,incoming.view||{},META);
  state=next;view=v;editing=null;eventDirty=false;refreshAll();
  // Write eligibility is granted ONLY here, after a FOUND payload has been fully validated AND
  // actually adopted on screen. A preserved local draft, a legacy or malformed payload, an empty
  // cloud or a stale response must never make the next 「儲存目前月份到雲端」 able to overwrite
  // the cloud: the operator has not seen the cloud version, so they must load and compare first.
  observed.set(month,fingerprint(p));
  ScheduleSaveLoadCore.rememberLoadedMonth(window,month,p);context();
  cloudStatus('已於開啟時載入雲端 '+month+'（本機原本沒有草稿，未覆蓋任何輸入）。尚未儲存或發布。');
 }catch(e){if(closed)return;cloudStatus('雲端讀取未成功（'+(e.code||'CLOUD_ERROR')+'）：'+e.message+'。畫面顯示的是'+localSource+'，不是雲端內容。')}
 finally{clearTimeout(timer);bootTimer=null;bootControl=null;bootBusy=false;if(!closed){$('cloud-load').disabled=$('cloud-save').disabled=false}}
}
// Only an operator-initiated cloud action blocks leaving. The startup read does not: it holds no
// unsaved work, and refusing navigation for up to BOOT_CLOUD_TIMEOUT_MS on every open told clean
// devices they had changes to lose.
// Assigned BEFORE the startup read is kicked off: bootCloudRead() runs synchronously up to its
// fetch, and the toolbar's 登出 ／ 雲端登入 buttons call window.calendarCanLeave?.(), so leaving
// that window undefined made an early click do nothing at all.
window.calendarCanLeave=()=>!busy&&guardSwitch();
if(!preview)bootCloudRead();
// Teardown stops the startup read rather than letting it run to its timeout: the abort settles the
// request now, and every apply step is additionally gated on `closed`.
return ()=>{closed=true;if(bootTimer)clearTimeout(bootTimer);bootTimer=null;if(bootControl)bootControl.abort();manualRoot?.unmount();for(const [t,f] of subscriptions)window.removeEventListener(t,f);delete window.calendarCanLeave};
};