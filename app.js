const DB_KEY = 'stall-ledger-v1';
const blankDB = () => ({ incomes: {}, purchases: [], adjustments: [], losses: [], inventory: {}, specialDays: {} });
let db = readDB();
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const today = () => new Date().toLocaleDateString('en-CA');
const money = n => '¥' + (Number(n) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = v => Number(v) || 0;
const safe = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
let activePeriod='month', selectedDate=today(), dashboardDate=today();
let editingPurchaseRecordId=null, editingAdjustmentRecordId=null, editingLossRecordId=null, editingProductId=null;
let newProductReturnTo='purchase';
function readDB(){ try { return { ...blankDB(), ...JSON.parse(localStorage.getItem(DB_KEY) || '{}') }; } catch { return blankDB(); } }
function seedDefaultIngredients(){
  let changed=false;
  for(const [name,unit] of [['鸡蛋','个'],['面粉','斤'],['猪肉','斤']]){
    if(Object.values(db.inventory).some(p=>p.name===name))continue;
    const id=crypto.randomUUID();db.inventory[id]={id,name,unit,qty:0,threshold:null};changed=true;
  }
  if(changed)localStorage.setItem(DB_KEY,JSON.stringify(db));
}
function saveDB(){ localStorage.setItem(DB_KEY, JSON.stringify(db)); render(); }
function monthKey(d=today()){ return d.slice(0,7); }
function purchaseTotal(p){ return num(p.qty) * num(p.unitCost) + num(p.extraCost); }
function expensesByDate(date){ return db.purchases.filter(p=>p.date===date).reduce((s,p)=>s+purchaseTotal(p),0) + (db.incomes[date]?.otherExpense || 0); }
function totalIncome(i={}){ return num(i.cash)+num(i.wechat)+num(i.alipay); }
function toast(message){ const el=$('#toast'); el.textContent=message; el.classList.add('show'); clearTimeout(toast.timer); toast.timer=setTimeout(()=>el.classList.remove('show'),2300); }
function setTodayInputs(){ $$('#incomeForm [name=date], #purchaseForm [name=date]').forEach(el=>{if(!el.value)el.value=today();}); }
function render(){
  const d=dashboardDate, inc=db.incomes[d]||{}, incoming=totalIncome(inc), expense=expensesByDate(d);
  $('#todayLabel').textContent=parseDate(d).toLocaleDateString('zh-CN',{year:'numeric',month:'long',day:'numeric',weekday:'short'});
  $('#incomeToday').textContent=money(incoming); $('#expenseToday').textContent=money(expense); $('#netToday').textContent=money(incoming-expense);
  const products=Object.values(db.inventory); $('#stockKinds').textContent=products.filter(p=>p.qty>0).length;
  renderProductSelect(); renderInventory(); renderPurchaseList(); renderStocktakeList(); renderLossList(); renderAlerts(); renderChannelSummary(); renderIncomeList(); renderRecent(); renderReports();
}
function renderProductSelect(){
  const select=$('#purchaseForm [name=productId]'),selected=select.value;
  select.innerHTML='<option value="">请选择原料</option>'+Object.values(db.inventory).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN')).map(p=>`<option value="${safe(p.id)}">${safe(p.name)}</option>`).join('');
  if(db.inventory[selected])select.value=selected;
  updatePurchaseProduct();
}
function updatePurchaseProduct(){
  const form=$('#purchaseForm'),p=db.inventory[form.elements.productId.value];
  form.elements.unit.value=p?.unit||'';
  $('#purchaseThresholdUnit').textContent=p?.unit||'单位';
  if(p&&!editingPurchaseRecordId)form.elements.threshold.value=p.threshold??'';
}
$('#purchaseForm [name=productId]').addEventListener('change',updatePurchaseProduct);
function renderInventory(){
  const rows=Object.values(db.inventory).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'));
  $('#inventoryList').innerHTML=rows.length?rows.map(p=>`<div class="stock-row inventory-row"><div class="activity-main"><span class="row-title">${safe(p.name)}</span><span class="row-sub">补货提醒值：${p.threshold==null?'未设置':`${p.threshold} ${safe(p.unit)}`}</span></div><div class="inventory-remaining"><small>当前剩余</small><strong>${p.qty} ${safe(p.unit)}</strong>${p.threshold!=null&&p.qty<=p.threshold?'<em>需补货</em>':''}</div><button class="edit-record" data-product-id="${safe(p.id)}">编辑</button></div>`).join(''):'<div class="empty-state">还没有库存记录，记一笔采购后会自动入库</div>';
  $$('#inventoryList [data-product-id]').forEach(b=>b.addEventListener('click',()=>openProductEdit(b.dataset.productId)));
}
function renderPurchaseList(){
  const rows=[...db.purchases].sort((a,b)=>b.date.localeCompare(a.date)||(b.createdAt||'').localeCompare(a.createdAt||''));
  $('#purchaseList').innerHTML=rows.length?rows.map(p=>`<div class="activity-row record-row"><div class="activity-main"><span class="row-title">${safe(p.date)} · ${safe(p.name)}</span><span class="row-sub">${p.qty} ${safe(p.unit)} · ${safe(p.supplier||'未填写供应商')} · ${money(p.unitCost)}/${safe(p.unit)}</span></div><div class="stock-amount">${money(purchaseTotal(p))}</div><div class="record-actions"><button class="edit-record" data-purchase-edit="${safe(p.recordId||p.id)}">修改</button><button class="delete-record" data-purchase-delete="${safe(p.recordId||p.id)}">删除</button></div></div>`).join(''):'<div class="empty-state">还没有采购记录</div>';
  $$('#purchaseList [data-purchase-edit]').forEach(b=>b.addEventListener('click',()=>editPurchase(b.dataset.purchaseEdit)));
  $$('#purchaseList [data-purchase-delete]').forEach(b=>b.addEventListener('click',()=>deleteRecord('purchase',b.dataset.purchaseDelete)));
}
function renderStocktakeList(){
  const rows=[...db.adjustments].sort((a,b)=>b.date.localeCompare(a.date)||(b.createdAt||'').localeCompare(a.createdAt||''));
  $('#stocktakeList').innerHTML=rows.length?rows.map(a=>`<div class="activity-row record-row"><div class="activity-main"><span class="row-title">${safe(a.date)} · ${safe(a.name)}</span><span class="row-sub">实盘剩余 ${a.actual??'—'} ${safe(db.inventory[a.id]?.unit||'')} · 账面差异 ${a.qty>0?'+':''}${a.qty} ${safe(db.inventory[a.id]?.unit||'')}${a.note?' · '+safe(a.note):''}</span></div><div class="record-actions"><button class="edit-record" data-stocktake-edit="${safe(a.recordId||a.id)}">修改</button><button class="delete-record" data-stocktake-delete="${safe(a.recordId||a.id)}">删除</button></div></div>`).join(''):'<div class="empty-state">还没有盘点记录</div>';
  $$('#stocktakeList [data-stocktake-edit]').forEach(b=>b.addEventListener('click',()=>editStocktake(b.dataset.stocktakeEdit)));
  $$('#stocktakeList [data-stocktake-delete]').forEach(b=>b.addEventListener('click',()=>deleteRecord('adjustment',b.dataset.stocktakeDelete)));
}
function renderLossList(){
  const rows=[...db.losses].sort((a,b)=>b.date.localeCompare(a.date)||(b.createdAt||'').localeCompare(a.createdAt||''));
  $('#lossList').innerHTML=rows.length?rows.map(a=>`<div class="activity-row record-row"><div class="activity-main"><span class="row-title">${safe(a.date)} · ${safe(a.name)}</span><span class="row-sub">额外损耗 ${a.qty} ${safe(db.inventory[a.id]?.unit||'')} · ${safe(a.reason)}${a.note?' · '+safe(a.note):''}</span></div><div class="record-actions"><button class="edit-record" data-loss-edit="${safe(a.recordId)}">修改</button><button class="delete-record" data-loss-delete="${safe(a.recordId)}">删除</button></div></div>`).join(''):'<div class="empty-state">目前没有额外损耗记录</div>';
  $$('#lossList [data-loss-edit]').forEach(b=>b.addEventListener('click',()=>editLoss(b.dataset.lossEdit)));
  $$('#lossList [data-loss-delete]').forEach(b=>b.addEventListener('click',()=>deleteRecord('loss',b.dataset.lossDelete)));
}
function renderAlerts(){
  const rows=Object.values(db.inventory).filter(p=>p.threshold!=null&&p.qty<=p.threshold);
  $('#stockAlerts').innerHTML=rows.length?rows.map(p=>`<div class="stock-row"><div><span class="row-title">${safe(p.name)}</span><span class="row-sub">补货提醒值 ${p.threshold} ${safe(p.unit)}</span></div><div class="stock-amount low-stock">${p.qty} ${safe(p.unit)}</div></div>`).join(''):'<div class="empty-state">目前没有低库存原料</div>';
}
function renderChannelSummary(){
  const totals={cash:0,wechat:0,alipay:0};
  Object.entries(db.incomes).forEach(([date,i])=>{if(date.startsWith(monthKey(dashboardDate)))Object.keys(totals).forEach(k=>totals[k]+=num(i[k]));});
  $('#channelSummary').innerHTML=[['现金','cash'],['微信','wechat'],['支付宝','alipay']].map(([label,k])=>`<div class="channel-box"><span>${label}</span><b>${money(totals[k])}</b></div>`).join('');
}
function renderIncomeList(){
  const rows=Object.entries(db.incomes).sort((a,b)=>b[0].localeCompare(a[0]));
  $('#incomeList').innerHTML=rows.length?rows.map(([date,i])=>`<div class="activity-row record-row"><div class="activity-main"><span class="row-title">${safe(date)} · ${money(totalIncome(i))}</span><span class="row-sub">现金 ${money(i.cash)} · 微信 ${money(i.wechat)} · 支付宝 ${money(i.alipay)}</span></div><div class="record-actions"><button class="edit-record" data-income-edit="${safe(date)}">修改</button><button class="delete-record" data-income-delete="${safe(date)}">删除</button></div></div>`).join(''):'<div class="empty-state">还没有每日收入记录</div>';
  $$('#incomeList [data-income-edit]').forEach(b=>b.addEventListener('click',()=>editIncome(b.dataset.incomeEdit)));
  $$('#incomeList [data-income-delete]').forEach(b=>b.addEventListener('click',()=>deleteRecord('income',b.dataset.incomeDelete)));
}
function editIncome(date){$('#incomeForm [name=date]').value=date;loadIncomeDate();activateTab('income');$('#incomeForm').scrollIntoView({behavior:'smooth',block:'start'});}
function renderRecent(){
  const items=[];
  Object.entries(db.incomes).forEach(([date,i])=>items.push({date,kind:'每日收入',sub:`现金 ${money(i.cash)} · 微信 ${money(i.wechat)} · 支付宝 ${money(i.alipay)}`,amount:totalIncome(i),sign:'+',type:'income',id:date}));
  db.purchases.forEach(p=>items.push({date:p.date,kind:`采购 · ${p.name}`,sub:`${p.qty} ${p.unit} · ${p.supplier||'未填写供应商'}`,amount:purchaseTotal(p),sign:'−',type:'purchase',id:p.recordId||p.id}));
  db.adjustments.forEach(a=>items.push({date:a.date,kind:`收摊盘点 · ${a.name}`,sub:`实际剩余 ${a.actual??'—'} · 库存差异 ${a.qty>0?'+':''}${a.qty} ${db.inventory[a.id]?.unit||''}${a.note?' · '+a.note:''}`,amount:a.qty,sign:'',type:'adjustment',id:a.recordId||a.id}));
  db.losses.forEach(a=>items.push({date:a.date,kind:`额外损耗 · ${a.name}`,sub:`${a.qty} ${db.inventory[a.id]?.unit||''} · ${a.reason}${a.note?' · '+a.note:''}`,amount:a.qty,sign:'',type:'loss',id:a.recordId}));
  items.sort((a,b)=>b.date.localeCompare(a.date));
  $('#recentList').innerHTML=items.length?items.map(x=>`<div class="activity-row"><div class="activity-main"><span class="row-title">${safe(x.kind)}</span><span class="row-sub">${safe(x.date)} · ${safe(x.sub)}</span></div><div class="stock-amount">${x.sign==='−'?'-':x.sign==='+'?'+':''}${x.sign?money(x.amount):''}</div><button class="delete-record" data-delete-type="${x.type}" data-delete-id="${safe(x.id)}">删除</button></div>`).join(''):'<div class="empty-state">还没有记录，保存后会显示在这里</div>';
  $$('#recentList .delete-record').forEach(b=>b.addEventListener('click',()=>deleteRecord(b.dataset.deleteType,b.dataset.deleteId)));
}
function deleteRecord(type,id){
  if(!confirm('确定删除这条记录吗？此操作无法撤销。'))return;
  if(type==='income')delete db.incomes[id];
  if(type==='purchase'){const index=db.purchases.findIndex(p=>(p.recordId||p.id)===id);if(index>=0){const productId=db.purchases[index].id;db.purchases.splice(index,1);recalculateInventory(productId);}}
  if(type==='adjustment'){const index=db.adjustments.findIndex(a=>(a.recordId||a.id)===id);if(index>=0){const productId=db.adjustments[index].id;db.adjustments.splice(index,1);recalculateInventory(productId);}}
  if(type==='loss'){const index=db.losses.findIndex(a=>a.recordId===id);if(index>=0){const productId=db.losses[index].id;db.losses.splice(index,1);recalculateInventory(productId);}}
  saveDB();toast('记录已删除');
}
function recalculateInventory(productId){
  const product=db.inventory[productId];if(!product)return;
  const events=[...db.purchases.filter(p=>p.id===productId).map(p=>({date:p.date,time:p.createdAt||`${p.date}T00:00:00`,type:0,qty:num(p.qty)})),...db.losses.filter(a=>a.id===productId).map(a=>({date:a.date,time:a.createdAt||`${a.date}T12:00:00`,type:1,qty:num(a.qty)})),...db.adjustments.filter(a=>a.id===productId).map(a=>({date:a.date,time:a.createdAt||`${a.date}T23:59:59`,type:2,source:a,actual:a.actual,qty:num(a.qty)}))].sort((a,b)=>a.date.localeCompare(b.date)||a.time.localeCompare(b.time)||a.type-b.type);
  let qty=0;events.forEach(e=>{if(e.type===0)qty+=e.qty;else if(e.type===1)qty-=e.qty;else if(e.actual==null)qty+=e.qty;else{e.source.qty=Math.round((num(e.actual)-qty)*1000)/1000;qty=num(e.actual);}});product.qty=Math.round(qty*1000)/1000;
}
function activateTab(name){ $$('.tab').forEach(t=>t.classList.toggle('active',t.dataset.tab===name)); $$('.view').forEach(v=>v.classList.toggle('active',v.id===`view-${name}`)); window.scrollTo({top:0,behavior:'smooth'}); }
$$('.tab').forEach(t=>t.addEventListener('click',()=>activateTab(t.dataset.tab)));
$$('[data-open]').forEach(b=>b.addEventListener('click',()=>{if(b.dataset.open==='income'){$('#incomeForm [name=date]').value=dashboardDate;loadIncomeDate();}activateTab(b.dataset.open);}));
$$('[data-tab-link]').forEach(b=>b.addEventListener('click',()=>activateTab(b.dataset.tabLink)));
$('#openIncomeSummary').addEventListener('click',()=>{$('#incomeForm [name=date]').value=dashboardDate;loadIncomeDate();activateTab('income');});
$('#openExpenseSummary').addEventListener('click',()=>{selectedDate=dashboardDate;activePeriod='day';$$('.period-button').forEach(b=>b.classList.toggle('active',b.dataset.period==='day'));renderReports();activateTab('reports');});
$('#openInventorySummary').addEventListener('click',()=>{activateTab('purchase');$('#inventoryList').scrollIntoView({behavior:'smooth',block:'start'});});
$('#todayLabel').addEventListener('click',()=>{$('#dateForm [name=date]').value=dashboardDate;$('#dateDialog').showModal();});
$('.close-date').addEventListener('click',()=>$('#dateDialog').close());
$('#dateForm').addEventListener('submit',e=>{e.preventDefault();dashboardDate=e.currentTarget.elements.date.value;selectedDate=dashboardDate;render();$('#dateDialog').close();});

$('#incomeForm').addEventListener('submit',e=>{
  e.preventDefault(); const f=new FormData(e.currentTarget), date=f.get('date');
  db.incomes[date]={cash:num(f.get('cash')),wechat:num(f.get('wechat')),alipay:num(f.get('alipay')),otherExpense:num(f.get('otherExpense')),note:f.get('note').trim(),updatedAt:new Date().toISOString()};
  saveDB();loadIncomeDate(); toast('当天收入已保存');
});
function loadIncomeDate(){
  const form=$('#incomeForm'),record=db.incomes[form.elements.date.value]||{};
  for(const key of ['cash','wechat','alipay','otherExpense'])form.elements[key].value=record[key]??'';
  form.elements.note.value=record.note||'';
  $('#incomeSubmit').textContent=db.incomes[form.elements.date.value]?'保存当天修改':'保存当天收入';
  $('#cancelIncomeEdit').classList.toggle('hidden',!db.incomes[form.elements.date.value]);
}
$('#incomeForm [name=date]').addEventListener('change',loadIncomeDate);
$('#cancelIncomeEdit').addEventListener('click',()=>{$('#incomeForm [name=date]').value=today();loadIncomeDate();});

function resetPurchaseEdit(){
  editingPurchaseRecordId=null;const form=$('#purchaseForm');form.reset();form.elements.productId.disabled=false;
  $('#purchaseSubmit').textContent='保存采购并入库';$('#purchaseEditNotice').classList.add('hidden');$('#cancelPurchaseEdit').classList.add('hidden');setTodayInputs();
}
function editPurchase(id){
  const p=db.purchases.find(x=>(x.recordId||x.id)===id);if(!p)return;
  editingPurchaseRecordId=id;const form=$('#purchaseForm');
  for(const [name,value] of Object.entries({date:p.date,supplier:p.supplier,productId:p.id,unit:p.unit,qty:p.qty,unitCost:p.unitCost,threshold:db.inventory[p.id]?.threshold??'',extraCost:p.extraCost,note:p.note}))form.elements[name].value=value??'';
  form.elements.productId.disabled=true;$('#purchaseSubmit').textContent='保存采购修改';$('#purchaseEditNotice').classList.remove('hidden');$('#cancelPurchaseEdit').classList.remove('hidden');form.scrollIntoView({behavior:'smooth',block:'start'});
}
$('#cancelPurchaseEdit').addEventListener('click',resetPurchaseEdit);

$('#purchaseForm').addEventListener('submit',e=>{
  e.preventDefault();const form=e.currentTarget,f=new FormData(form),id=editingPurchaseRecordId?db.purchases.find(p=>(p.recordId||p.id)===editingPurchaseRecordId)?.id:f.get('productId'),product=db.inventory[id];
  if(!product){toast('请先选择或新增原料');return;}
  const fields={date:f.get('date'),supplier:f.get('supplier').trim(),qty:num(f.get('qty')),unitCost:num(f.get('unitCost')),extraCost:num(f.get('extraCost')),note:f.get('note').trim()};
  product.threshold=f.get('threshold')===''?null:num(f.get('threshold'));
  if(editingPurchaseRecordId){const p=db.purchases.find(x=>(x.recordId||x.id)===editingPurchaseRecordId);Object.assign(p,fields,{threshold:product.threshold});recalculateInventory(id);resetPurchaseEdit();saveDB();toast('采购记录已修改');return;}
  db.purchases.push({recordId:crypto.randomUUID(),createdAt:new Date().toISOString(),id,name:product.name,unit:product.unit,threshold:product.threshold,...fields});recalculateInventory(id);resetPurchaseEdit();saveDB();toast('采购已保存，库存已增加');
});

$('#addProduct').addEventListener('click',()=>{newProductReturnTo='purchase';$('#newProductDialog').showModal();});
$('#addProductFromStocktake').addEventListener('click',()=>{newProductReturnTo='stocktake';$('#newProductDialog').showModal();});
$('.close-new-product').addEventListener('click',()=>$('#newProductDialog').close());
$$('.ingredient-suggestions button').forEach(button=>button.addEventListener('click',()=>{const form=$('#newProductForm');form.elements.name.value=button.dataset.suggestName;form.elements.unit.value=button.dataset.suggestUnit;$('#newProductThresholdUnit').textContent=button.dataset.suggestUnit;}));
$('#newProductForm [name=unit]').addEventListener('change',e=>$('#newProductThresholdUnit').textContent=e.target.value||'单位');
$('#newProductForm').addEventListener('submit',e=>{
  e.preventDefault();const form=e.currentTarget,f=new FormData(form),name=f.get('name').trim(),unit=f.get('unit');
  if(Object.values(db.inventory).some(p=>p.name.toLowerCase()===name.toLowerCase())){toast('原料已存在，请直接从列表选择');return;}
  const id=crypto.randomUUID();db.inventory[id]={id,name,unit,qty:0,threshold:f.get('threshold')===''?null:num(f.get('threshold'))};
  saveDB();
  if(newProductReturnTo==='stocktake'){populateStocktakeProducts(id);}else{$('#purchaseForm [name=productId]').value=id;updatePurchaseProduct();}
  $('#newProductDialog').close();form.reset();$('#newProductThresholdUnit').textContent='单位';toast('原料已加入选项');
});
function openProductEdit(id){
  const p=db.inventory[id];if(!p)return;editingProductId=id;const form=$('#productForm');form.elements.name.value=p.name;form.elements.unit.value=p.unit;form.elements.threshold.value=p.threshold??'';$('#productThresholdUnit').textContent=p.unit;$('#productDialog').showModal();
}
$('.close-product').addEventListener('click',()=>$('#productDialog').close());
$('#productForm [name=unit]').addEventListener('change',e=>$('#productThresholdUnit').textContent=e.target.value||'单位');
$('#productForm').addEventListener('submit',e=>{
  e.preventDefault();const p=db.inventory[editingProductId];if(!p)return;const f=new FormData(e.currentTarget),name=f.get('name').trim(),unit=f.get('unit');
  if(Object.values(db.inventory).some(x=>x.id!==p.id&&x.name.toLowerCase()===name.toLowerCase())){toast('已有同名原料，请换一个名称');return;}
  Object.assign(p,{name,unit,threshold:f.get('threshold')===''?null:num(f.get('threshold'))});db.purchases.filter(x=>x.id===p.id).forEach(x=>Object.assign(x,{name,unit}));db.adjustments.filter(x=>x.id===p.id).forEach(x=>x.name=name);db.losses.filter(x=>x.id===p.id).forEach(x=>x.name=name);
  saveDB();$('#productDialog').close();editingProductId=null;toast('原料信息已修改');
});
$('#deleteProduct').addEventListener('click',()=>{
  const id=editingProductId;if(!id)return;
  if(db.purchases.some(p=>p.id===id)||db.adjustments.some(a=>a.id===id)||db.losses.some(a=>a.id===id)){toast('请先删除该原料的采购、盘点和损耗记录');return;}
  if(!confirm('确定删除这个原料吗？'))return;delete db.inventory[id];editingProductId=null;saveDB();$('#productDialog').close();toast('原料已删除');
});

function populateStocktakeProducts(selectedId){
  const select=$('#adjustForm [name=product]');select.innerHTML=Object.values(db.inventory).map(p=>`<option value="${safe(p.id)}">${safe(p.name)}（现有 ${p.qty} ${safe(p.unit)}）</option>`).join('');
  if(selectedId)select.value=selectedId;
}
function openStocktake(){
  const products=Object.values(db.inventory); if(!products.length){toast('先新增原料并记录采购');return;}
  editingAdjustmentRecordId=null;const form=$('#adjustForm');form.reset();form.elements.product.disabled=false;populateStocktakeProducts();$('#adjustDialog').showModal();
}
$('#adjustStock').addEventListener('click',openStocktake);
$('#quickStocktake').addEventListener('click',openStocktake);
function editStocktake(id){
  const a=db.adjustments.find(x=>(x.recordId||x.id)===id);if(!a)return;editingAdjustmentRecordId=id;const form=$('#adjustForm');form.elements.product.innerHTML=`<option value="${safe(a.id)}">${safe(a.name)}</option>`;form.elements.product.value=a.id;form.elements.product.disabled=true;form.elements.qty.value=a.actual??'';form.elements.note.value=a.note||'';$('#adjustDialog').showModal();
}
$('.close-button').addEventListener('click',()=>$('#adjustDialog').close());
$('#adjustDialog').addEventListener('close',()=>{editingAdjustmentRecordId=null;$('#adjustForm').reset();$('#adjustForm [name=product]').disabled=false;});
$('#adjustForm').addEventListener('submit',e=>{
  e.preventDefault(); const f=new FormData(e.currentTarget), id=editingAdjustmentRecordId?db.adjustments.find(a=>(a.recordId||a.id)===editingAdjustmentRecordId)?.id:f.get('product'),p=db.inventory[id],actual=num(f.get('qty')); if(!p)return;
  if(editingAdjustmentRecordId){const a=db.adjustments.find(x=>(x.recordId||x.id)===editingAdjustmentRecordId);a.actual=actual;a.note=f.get('note').trim();recalculateInventory(id);saveDB();$('#adjustDialog').close();toast('盘点记录已修改');return;}
  const delta=Math.round((actual-p.qty)*1000)/1000; p.qty=actual; db.adjustments.push({recordId:crypto.randomUUID(),createdAt:new Date().toISOString(),date:today(),id:p.id,name:p.name,qty:delta,actual,note:f.get('note').trim()}); saveDB(); $('#adjustDialog').close(); e.currentTarget.reset(); toast('盘点结果已保存');
});

function fillLossProducts(selectedId){
  const select=$('#lossForm [name=product]');select.innerHTML=Object.values(db.inventory).map(p=>`<option value="${safe(p.id)}">${safe(p.name)}（剩余 ${p.qty} ${safe(p.unit)}）</option>`).join('');
  if(selectedId)select.value=selectedId;$('#lossUnit').textContent=db.inventory[select.value]?.unit||'单位';
}
$('#addLoss').addEventListener('click',()=>{
  editingLossRecordId=null;const form=$('#lossForm');form.reset();form.elements.date.value=today();form.elements.product.disabled=false;fillLossProducts();$('#lossDialog').showModal();
});
$('#lossForm [name=product]').addEventListener('change',e=>$('#lossUnit').textContent=db.inventory[e.target.value]?.unit||'单位');
function editLoss(id){
  const a=db.losses.find(x=>x.recordId===id);if(!a)return;editingLossRecordId=id;const form=$('#lossForm');
  fillLossProducts(a.id);form.elements.product.disabled=true;form.elements.date.value=a.date;form.elements.qty.value=a.qty;form.elements.reason.value=a.reason;form.elements.note.value=a.note||'';$('#lossDialog').showModal();
}
$('.close-loss').addEventListener('click',()=>$('#lossDialog').close());
$('#lossDialog').addEventListener('close',()=>{editingLossRecordId=null;$('#lossForm [name=product]').disabled=false;});
$('#lossForm').addEventListener('submit',e=>{
  e.preventDefault();const form=e.currentTarget,f=new FormData(form),existing=editingLossRecordId?db.losses.find(x=>x.recordId===editingLossRecordId):null;
  const id=existing?.id||f.get('product'),product=db.inventory[id],qty=num(f.get('qty'));
  if(!product){toast('请选择原料');return;}
  if(qty>product.qty+(existing?.qty||0)){toast('损耗数量不能超过当前记录的剩余库存');return;}
  if(existing){Object.assign(existing,{date:f.get('date'),qty,reason:f.get('reason'),note:f.get('note').trim()});recalculateInventory(id);saveDB();$('#lossDialog').close();toast('损耗记录已修改');return;}
  db.losses.push({recordId:crypto.randomUUID(),createdAt:new Date().toISOString(),date:f.get('date'),id,name:product.name,qty,reason:f.get('reason'),note:f.get('note').trim()});recalculateInventory(id);saveDB();$('#lossDialog').close();toast('额外损耗已记录');
});

function parseDate(s){const [y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d);}
function dateString(d){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
function dateRecord(d){return db.incomes[d]||{};}
function activityOn(d){return Boolean(db.incomes[d]||db.purchases.some(p=>p.date===d)||db.adjustments.some(a=>a.date===d)||db.losses.some(a=>a.date===d));}
function monthTitle(d){return `${d.getFullYear()}年${d.getMonth()+1}月`;}
function weekBounds(d){const start=new Date(d);start.setDate(start.getDate()-((start.getDay()+6)%7));const end=new Date(start);end.setDate(start.getDate()+6);return [start,end];}
function periodBounds(){const d=parseDate(selectedDate);if(activePeriod==='day')return[d,d];if(activePeriod==='week')return weekBounds(d);if(activePeriod==='month')return[new Date(d.getFullYear(),d.getMonth(),1),new Date(d.getFullYear(),d.getMonth()+1,0)];return[new Date(d.getFullYear(),0,1),new Date(d.getFullYear(),11,31)];}
function dailyTotals(d){const i=dateRecord(d), purchases=db.purchases.filter(p=>p.date===d).reduce((s,p)=>s+purchaseTotal(p),0), other=num(i.otherExpense), income=totalIncome(i);return {cash:num(i.cash),wechat:num(i.wechat),alipay:num(i.alipay),income,purchases,other,expense:purchases+other,net:income-purchases-other};}
function renderCalendar(){
  const chosen=parseDate(selectedDate), first=new Date(chosen.getFullYear(),chosen.getMonth(),1), start=new Date(first);start.setDate(first.getDate()-((first.getDay()+6)%7));
  $('#calendarTitle').textContent=activePeriod==='year'?`${chosen.getFullYear()}年`:activePeriod==='day'?`${chosen.getFullYear()}年${chosen.getMonth()+1}月${chosen.getDate()}日`:activePeriod==='week'?`${weekBounds(chosen).map(dateString).join(' 至 ')}`:monthTitle(chosen);
  const daysInMonth=new Date(chosen.getFullYear(),chosen.getMonth()+1,0).getDate(),offset=(first.getDay()+6)%7,cellCount=Math.ceil((offset+daysInMonth)/7)*7;
  const html=[];for(let n=0;n<cellCount;n++){const cell=new Date(start);cell.setDate(start.getDate()+n);const key=dateString(cell),inMonth=cell.getMonth()===chosen.getMonth(),tot=dailyTotals(key),has=activityOn(key),event=db.specialDays[key];html.push(`<button class="calendar-day ${inMonth?'':'outside'} ${key===selectedDate?'selected':''} ${key===today()?'today':''} ${has?'has-record':''} ${event?'special-day':''}" data-date="${key}" title="${event?safe(event.category+' · '+event.title):key}" aria-label="${key}${event?'，'+safe(event.title):''}，收入${money(tot.income)}，支出${money(tot.expense)}"><b>${cell.getDate()}</b></button>`);}
  $('#calendarGrid').innerHTML=html.join('');$$('.calendar-day').forEach(b=>b.addEventListener('click',()=>{selectedDate=b.dataset.date;renderReports();}));
}
function renderReports(){
  if(!$('#calendarGrid'))return;renderCalendar();renderSpecialDayForm();
  const [start,end]=periodBounds(), startKey=dateString(start),endKey=dateString(end),dates=Object.keys(db.incomes).concat(db.purchases.map(p=>p.date),db.adjustments.map(a=>a.date),db.losses.map(a=>a.date),Object.keys(db.specialDays)).filter((v,i,a)=>a.indexOf(v)===i&&v>=startKey&&v<=endKey).sort();
  const totals=dates.reduce((acc,d)=>{const x=dailyTotals(d);for(const k of Object.keys(acc))acc[k]+=x[k];return acc;},{cash:0,wechat:0,alipay:0,income:0,purchases:0,other:0,expense:0,net:0});
  if(activePeriod==='day'&&!dates.includes(selectedDate)){const x=dailyTotals(selectedDate);Object.assign(totals,x);}
  $('#periodSummary').innerHTML=`<div class="report-metric"><span>总收入</span><b>${money(totals.income)}</b></div><div class="report-metric"><span>总支出</span><b>${money(totals.expense)}</b></div><div class="report-metric"><span>经营结余</span><b>${money(totals.net)}</b></div><div class="report-channels">${[['现金',totals.cash],['微信',totals.wechat],['支付宝',totals.alipay]].map(([n,v])=>`<div class="channel-box"><span>${n}</span><b>${money(v)}</b></div>`).join('')}</div>`;
  const dailyBreakdown=$('#dailyExpenseBreakdown');dailyBreakdown.classList.toggle('hidden',activePeriod!=='day');if(activePeriod==='day'){const x=dailyTotals(selectedDate);dailyBreakdown.innerHTML=`<div class="stock-row"><span class="row-title">采购支出</span><strong>${money(x.purchases)}</strong></div><div class="stock-row"><span class="row-title">其他日常支出</span><strong>${money(x.other)}</strong></div>`;}
  $('#breakdownTitle').textContent=activePeriod==='year'?'每月汇总':activePeriod==='day'?'当日明细':'每日明细';
  let buckets=[];
  if(activePeriod==='year'){
    for(let m=0;m<12;m++){const ym=`${selectedDate.slice(0,4)}-${String(m+1).padStart(2,'0')}`, ds=dates.filter(d=>d.startsWith(ym));if(ds.length){const x=ds.reduce((a,d)=>{const t=dailyTotals(d);for(const k of Object.keys(a))a[k]+=t[k];return a;},{cash:0,wechat:0,alipay:0,income:0,purchases:0,other:0,expense:0,net:0});buckets.push({label:`${m+1}月`,sub:`${ds.length} 天有记录 · 现金 ${money(x.cash)} / 微信 ${money(x.wechat)} / 支付宝 ${money(x.alipay)}`,...x});}}
  }else {const list=activePeriod==='day'?[selectedDate]:dates; buckets=list.map(d=>({label:d,sub:`现金 ${money(dailyTotals(d).cash)} · 微信 ${money(dailyTotals(d).wechat)} · 支付宝 ${money(dailyTotals(d).alipay)}`,...dailyTotals(d)}));}
  $('#periodRows').innerHTML=buckets.length?buckets.reverse().map(x=>`<div class="activity-row"><div><span class="row-title">${safe(x.label)}</span><span class="row-sub">${safe(x.sub)} · 支出 ${money(x.expense)}</span></div><div class="stock-amount">${money(x.net)}</div></div>`).join(''):'<div class="empty-state">这个周期还没有经营记录</div>';
  renderAnalysis(dates,totals);
}
function renderSpecialDayForm(){
  const event=db.specialDays[selectedDate],form=$('#specialDayForm');$('#specialDateTitle').textContent=`${selectedDate} · ${event?'已标记特别日期':'标记特别日期'}`;
  form.elements.date.value=selectedDate;form.elements.category.value=event?.category||'学校放假';form.elements.title.value=event?.title||'';form.elements.note.value=event?.note||'';$('#deleteSpecialDay').classList.toggle('hidden',!event);
}
$('#specialDayForm [name=date]').addEventListener('change',e=>{if(!e.target.value)return;selectedDate=e.target.value;renderReports();});
$('#specialDayForm').addEventListener('submit',e=>{
  e.preventDefault();const f=new FormData(e.currentTarget);selectedDate=f.get('date');db.specialDays[selectedDate]={category:f.get('category'),title:f.get('title').trim(),note:f.get('note').trim()};saveDB();toast('特别日期已保存');
});
$('#deleteSpecialDay').addEventListener('click',()=>{if(!db.specialDays[selectedDate])return;if(!confirm('确定删除这一天的特别日期标记吗？'))return;delete db.specialDays[selectedDate];saveDB();toast('日期标记已删除');});
function renderAnalysis(dates,totals){
  const incomeDates=dates.filter(d=>db.incomes[d]), activeCount=incomeDates.length, avg=activeCount?totals.income/activeCount:0;
  const best=incomeDates.map(d=>({date:d,income:totalIncome(db.incomes[d])})).sort((a,b)=>b.income-a.income)[0];
  const channelEntries=[['现金',totals.cash],['微信',totals.wechat],['支付宝',totals.alipay]].sort((a,b)=>b[1]-a[1]);
  const top=channelEntries[0],share=totals.income?Math.round(top[1]/totals.income*100):0;
  const special=incomeDates.filter(d=>db.specialDays[d]),ordinary=incomeDates.filter(d=>!db.specialDays[d]);
  const specialAvg=special.length?special.reduce((s,d)=>s+totalIncome(db.incomes[d]),0)/special.length:0;
  const ordinaryAvg=ordinary.length?ordinary.reduce((s,d)=>s+totalIncome(db.incomes[d]),0)/ordinary.length:0;
  let comparison='记录几次特殊日期后，就能和普通营业日对比';
  if(special.length&&ordinary.length){const pct=ordinaryAvg?Math.round((specialAvg/ordinaryAvg-1)*100):null;comparison=`特殊日 ${special.length} 天 · 普通日 ${ordinary.length} 天 · ${pct===null?'普通日收入为 ¥0':`特殊日平均${pct>=0?'高':'低'} ${Math.abs(pct)}%`}`;}
  $('#analysisCards').innerHTML=`<div class="analysis-card"><span>有收入记录的日均</span><b>${money(avg)}</b><small>共 ${activeCount} 天</small></div><div class="analysis-card"><span>本周期最高收入日</span><b>${best?money(best.income):'—'}</b><small>${best?safe(best.date):'记录后显示'}</small></div><div class="analysis-card"><span>主要收款渠道</span><b>${totals.income?`${top[0]} · ${share}%`:'—'}</b><small>${totals.income?`${money(top[1])} / 总收入 ${money(totals.income)}`:'记录收入后显示'}</small></div><div class="analysis-card"><span>特殊日期对比</span><b>${special.length?money(specialAvg):'待积累'}</b><small>${safe(comparison)}</small></div>`;
}
$$('.period-button').forEach(b=>b.addEventListener('click',()=>{activePeriod=b.dataset.period;renderReports();$$('.period-button').forEach(x=>x.classList.toggle('active',x===b));}));
function shiftPeriod(direction){const d=parseDate(selectedDate);if(activePeriod==='day')d.setDate(d.getDate()+direction);else if(activePeriod==='week')d.setDate(d.getDate()+7*direction);else if(activePeriod==='month')d.setMonth(d.getMonth()+direction);else d.setFullYear(d.getFullYear()+direction);selectedDate=dateString(d);renderReports();}
$('#calendarPrev').addEventListener('click',()=>shiftPeriod(-1));$('#calendarNext').addEventListener('click',()=>shiftPeriod(1));

function csvCell(v){return '"'+String(v??'').replace(/"/g,'""')+'"';}
function downloadCSV(filename,rows){
  const content='\ufeff'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n'); const blob=new Blob([content],{type:'text/csv;charset=utf-8'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=filename; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
$('#exportDaily').addEventListener('click',()=>{
  const dates=new Set([...Object.keys(db.incomes),...db.purchases.map(p=>p.date),...Object.keys(db.specialDays)]); const sorted=[...dates].sort();
  const rows=[['日期','现金收入','微信收入','支付宝收入','总收入','采购支出','其他支出','经营结余','日期类型','日期事件','备注']];
  sorted.forEach(d=>{const i=db.incomes[d]||{}, purchases=db.purchases.filter(p=>p.date===d).reduce((s,p)=>s+purchaseTotal(p),0), other=num(i.otherExpense), revenue=totalIncome(i), event=db.specialDays[d]||{};rows.push([d,num(i.cash).toFixed(2),num(i.wechat).toFixed(2),num(i.alipay).toFixed(2),revenue.toFixed(2),purchases.toFixed(2),other.toFixed(2),(revenue-purchases-other).toFixed(2),event.category||'',event.title||'',event.note||i.note||'']);});
  downloadCSV('摆摊每日账目.csv',rows); toast('每日账目已导出');
});
$('#exportPurchases').addEventListener('click',()=>{
  const rows=[['日期','供应商','商品','数量','单位','单价','商品金额','其他采购支出','备注']];
  [...db.purchases].sort((a,b)=>a.date.localeCompare(b.date)).forEach(p=>rows.push([p.date,p.supplier,p.name,p.qty,p.unit,num(p.unitCost).toFixed(2),(p.qty*p.unitCost).toFixed(2),num(p.extraCost).toFixed(2),p.note]));
  downloadCSV('摆摊采购明细.csv',rows); toast('采购明细已导出');
});

$('#exportBackup').addEventListener('click',()=>{
  const blob=new Blob([JSON.stringify({format:'stall-ledger-v1',exportedAt:new Date().toISOString(),data:db},null,2)],{type:'application/json'});
  const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`摆摊小账本备份-${today()}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);toast('完整账本已导出');
});
$('#importBackup').addEventListener('click',()=>$('#backupFile').click());
$('#backupFile').addEventListener('change',async e=>{
  const file=e.target.files?.[0];if(!file)return;
  try{
    const payload=JSON.parse(await file.text()),candidate=payload.data||payload;
    if(!candidate||typeof candidate.incomes!=='object'||!Array.isArray(candidate.purchases)||!Array.isArray(candidate.adjustments)||typeof candidate.inventory!=='object')throw new Error('备份格式不正确');
    if(!confirm('导入会替换此设备当前的全部记录。请先导出当前账本备份，确定继续吗？'))return;
    db={...blankDB(),...candidate};saveDB();toast('账本已从备份恢复');
  }catch(err){toast(err.message||'导入失败，请选择正确的备份文件');}
  finally{e.target.value='';}
});

seedDefaultIngredients();
setTodayInputs();
$('#incomeForm [name=date]').value=today();
render();
if('serviceWorker' in navigator&&location.protocol==='https:')navigator.serviceWorker.register('./sw.js').catch(()=>{});

