const test=require('node:test');
const assert=require('node:assert/strict');
const V=require('../timetable-view.js');
const meta={clinics:[{id:'jin',name:'晉安'},{id:'yi',name:'毅安'}]};
const initial={template:'calendar',format:'dual',clinicId:'jin'};
const poster={render:(_s,_m,scope)=>({clinics:scope.clinics.map(c=>c.id).join(','),complete:true,fatal:false,layout:{clinicIds:scope.clinics.map(c=>c.id),commands:[],width:1080,height:1920}})};
test('old drafts default to Jinan first without changing metadata',()=>{
 const v=V.setView(initial,{},meta);assert.equal(v.topClinicId,'jin');
 assert.equal(V.render({},'',meta,{},poster,v).clinics,'jin,yi');
});
test('Yian first applies to preview, PNG view and print without mutating clinics',()=>{
 const v=V.setView(initial,{topClinicId:'yi'},meta);
 assert.equal(V.render({},'',meta,{},poster,v).clinics,'yi,jin');
 assert.deepEqual(V.renderPrint({},'',meta,{},poster,v).layout.clinicIds,['yi','jin']);
 assert.deepEqual(meta.clinics.map(c=>c.id),['jin','yi']);
 assert.equal(V.setView(initial,JSON.parse(JSON.stringify(v)),meta).topClinicId,'yi');
});
test('single clinic selection stays independent of dual order',()=>{
 const v=V.setView(initial,{format:'a4',topClinicId:'yi',clinicId:'jin'},meta);
 assert.equal(V.render({},'',meta,{},poster,v).clinics,'jin');
 assert.throws(()=>V.setView(initial,{topClinicId:'unknown'},meta),/INVALID_VIEW/);
});
