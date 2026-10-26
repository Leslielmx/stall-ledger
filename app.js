const DB_KEY = 'stall-ledger-v1';
const defaultExpenseCategories=['交通费','摊位费','运费','包装耗材','燃气电费','设备用品','其他支出'];
const blankDB = () => ({ incomes: {}, purchases: [], expenses: [], expenseCategories:[...defaultExpenseCategories], adjustments: [], losses: [], inventory: {}, specialDays: {} });
let db;
const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];
const today = () => new Date().toLocaleDateString('en-CA');
const money = n => '¥' + (Number(n) || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = v => Number(v) || 0;
const safe = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const unitFactors={kg:1000,g:1,'公斤':1000,'斤':500,'两':50,'克':1,L:1000,mL:1,'升':1000,'毫升':1};
const unitGroup=unit=>['kg','g','公斤','斤','两','克'].includes(unit)?'mass':['L','mL','升','毫升'].includes(unit)?'volume':unit;
const roundQty=value=>Math.round((value+Number.EPSILON)*1000000)/1000000;
function convertQty(qty,from,to){if(from===to)return num(qty);if(unitGroup(from)!==unitGroup(to)||!unitFactors[from]||!unitFactors[to])return null;return roundQty(num(qty)*unitFactors[from]/unitFactors[to]);}
function unitChoices(unit){return unitGroup(unit)==='mass'?[['kg','kg'],['g','g']]:unitGroup(unit)==='volume'?[['L','L'],['mL','mL']]:[[unit,unit]];}
function unitOptions(unit){return unitChoices(unit).map(([value,label])=>`<option value="${safe(value)}">${safe(label)}</option>`).join('');}
db = readDB();
let activePeriod='month', selectedDate=today(), dashboardDate=today();
let reportChartStyle='bar', reportChartMetric='income';
let comparisonCategory='';
let calendarPeriod='month', calendarDate=today(), markedDate=today();
let editingPurchaseRecordId=null, editingExpenseRecordId=null, editingAdjustmentRecordId=null, editingLossRecordId=null, editingProductId=null;
let newProductReturnTo='purchase';
function normalizeDB(raw){
  const data={...blankDB(),...raw};data.expenses=Array.isArray(data.expenses)?data.expenses:[];
  data.expenseCategories=[...new Set([...defaultExpenseCategories,...(Array.isArray(data.expenseCategories)?data.expenseCategories:[]),...data.expenses.map(e=>e.category)].filter(x=>typeof x==='string'&&x.trim()))];
  for(const [date,income] of Object.entries(data.incomes)){
    const amount=num(income.otherExpense);
    if(amount>0&&!data.expenses.some(e=>e.recordId===`legacy-${date}`))data.expenses.push({recordId:`legacy-${date}`,date,category:'其他支出',item:'旧版每日支出',amount,note:'从旧版收入记录迁移',createdAt:`${date}T12:00:00`});
    delete income.otherExpense;
  }
  if(data.unitSchema!==2){
    for(const product of Object.values(data.inventory||{})){
      const oldUnit=product.unit,newUnit=unitGroup(oldUnit)==='mass'?'kg':unitGroup(oldUnit)==='volume'?'L':oldUnit;
      if(oldUnit===newUnit)continue;
      const ratio=convertQty(1,oldUnit,newUnit);if(ratio==null)continue;
      product.qty=roundQty(num(product.qty)*ratio);
      if(product.threshold!=null)product.threshold=roundQty(num(product.threshold)*ratio);
      product.unit=newUnit;
      for(const purchase of data.purchases.filter(p=>p.id===product.id)){
        const purchaseUnit=purchase.unit||oldUnit,converted=convertQty(purchase.qty,purchaseUnit,newUnit);
        if(converted==null)continue;
        purchase.qty=converted;purchase.unitCost=ratioForPrice(purchase.unitCost,purchaseUnit,newUnit);
        purchase.unit=newUnit;
        if(purchase.threshold!=null)purchase.threshold=roundQty(num(purchase.threshold)*ratio);
      }
      for(const adjustment of data.adjustments.filter(a=>a.id===product.id)){
        adjustment.qty=roundQty(num(adjustment.qty)*ratio);
        if(adjustment.actual!=null)adjustment.actual=roundQty(num(adjustment.actual)*ratio);
        if(adjustment.inputUnit){const input=convertQty(adjustment.inputQty,adjustment.inputUnit,newUnit);adjustment.inputQty=input??adjustment.inputQty;adjustment.inputUnit=newUnit;}
      }
      for(const loss of data.losses.filter(a=>a.id===product.id))loss.qty=roundQty(num(loss.qty)*ratio);
    }
    data.unitSchema=2;
  }
  return data;
}
function ratioForPrice(price,from,to){const factor=convertQty(1,from,to);return factor?roundQty(num(price)/factor):num(price);}
function readDB(){ try { const raw=JSON.parse(localStorage.getItem(DB_KEY)||'{}');const migrated=Object.values(raw.incomes||{}).some(i=>Object.hasOwn(i,'otherExpense'))||raw.unitSchema!==2||!Array.isArray(raw.expenseCategories);const data=normalizeDB(raw);if(migrated)localStorage.setItem(DB_KEY,JSON.stringify(data));return data; } catch { return blankDB(); } }
function seedDefaultIngredients(){
  let changed=false;
  for(const [name,unit] of [['鸡蛋','个'],['面粉','kg'],['猪肉','kg']]){
    if(Object.values(db.inventory).some(p=>p.name===name))continue;
    const id=crypto.randomUUID();db.inventory[id]={id,name,unit,qty:0,threshold:null};changed=true;
  }
  if(changed)localStorage.setItem(DB_KEY,JSON.stringify(db));
}
function saveDB(){ localStorage.setItem(DB_KEY, JSON.stringify(db)); render(); }
function monthKey(d=today()){ return d.slice(0,7); }
function purchaseTotal(p){ return num(p.qty) * num(p.unitCost) + num(p.extraCost); }
function expensesByDate(date){ return db.purchases.filter(p=>p.date===date).reduce((s,p)=>s+purchaseTotal(p),0) + db.expenses.filter(e=>e.date===date).reduce((s,e)=>s+num(e.amount),0); }
function totalIncome(i={}){ return num(i.cash)+num(i.wechat)+num(i.alipay); }
function toast(message){ const el=$('#toast'); el.textContent=message; el.classList.add('show'); clearTimeout(toast.timer); toast.timer=setTimeout(()=>el.classList.remove('show'),2300); }
function setTodayInputs(){ $$('#incomeForm [name=date], #purchaseForm [name=date], #expenseForm [name=date]').forEach(el=>{if(!el.value)el.value=today();}); }
function render(){
  const d=dashboardDate, inc=db.incomes[d]||{}, incoming=totalIncome(inc), expense=expensesByDate(d);
  $('#todayLabel').textContent=parseDate(d).toLocaleDateString('zh-CN',{year:'numeric',month:'long',day:'numeric',weekday:'short'});
  $('#incomeToday').textContent=money(incoming); $('#expenseToday').textContent=money(expense); $('#netToday').textContent=money(incoming-expense);
  const products=Object.values(db.inventory); $('#stockKinds').textContent=products.filter(p=>p.qty>0).length;
  renderProductSelect(); renderExpenseCategorySelect(); renderInventory(); renderPurchaseList(); renderExpenseList(); renderStocktakeList(); renderLossList(); renderAlerts(); renderChannelSummary(); renderIncomeList(); renderRecent(); renderWeekTrend(); renderCalendar(); renderReports();
}
function renderExpenseCategorySelect(){const select=$('#expenseForm [name=category]'),selected=select.value;select.innerHTML=db.expenseCategories.map(category=>`<option value="${safe(category)}">${safe(category)}</option>`).join('');if(db.expenseCategories.includes(selected))select.value=selected;}
function renderProductSelect(){
  const select=$('#purchaseForm [name=productId]'),selected=select.value;
  select.innerHTML='<option value="">请选择原料</option>'+Object.values(db.inventory).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN')).map(p=>`<option value="${safe(p.id)}">${safe(p.name)}</option>`).join('');
  if(db.inventory[selected])select.value=selected;
  updatePurchaseProduct();
}
function updatePurchaseProduct(){
  const form=$('#purchaseForm'),p=db.inventory[form.elements.productId.value];
  const select=form.elements.unit,previousProduct=select.dataset.productId,previousUnit=select.value;
  select.innerHTML=p?unitOptions(p.unit):'<option value="">先选原料</option>';
  if(p){select.value=previousProduct===p.id&&unitChoices(p.unit).some(([unit])=>unit===previousUnit)?previousUnit:p.unit;select.dataset.productId=p.id;}
  else delete select.dataset.productId;
  $('#purchaseThresholdUnit').textContent=p?.unit||'单位';
  if(p&&!editingPurchaseRecordId)form.elements.threshold.value=p.threshold??'';
  updatePurchaseConversionHint();
}
$('#purchaseForm [name=productId]').addEventListener('change',updatePurchaseProduct);
function updatePurchaseConversionHint(){const form=$('#purchaseForm'),p=db.inventory[form.elements.productId.value],unit=form.elements.unit.value,qty=form.elements.qty.value,target=$('#purchaseConversionHint');if(!p){target.textContent='选择原料后，会显示适用于该原料的采购单位。新增或编辑原料时可选择 kg、g、个、份、盒、袋、包、瓶、杯、串、件、箱、L、mL、桶。';return;}const converted=qty===''?null:convertQty(qty,unit,p.unit),choices=unitChoices(p.unit).map(([value])=>value).join(' / ');target.textContent=converted==null?`库存统一按 ${p.unit} 记录；本次采购可选单位：${choices}。${unitGroup(p.unit)==='mass'?'1 kg = 1000 g。':''}`:`本次 ${qty} ${unit} = 入库 ${converted} ${p.unit}；补货提醒值也按 ${p.unit} 填写。`;}
$('#purchaseForm [name=unit]').addEventListener('change',updatePurchaseConversionHint);
$('#purchaseForm [name=qty]').addEventListener('input',updatePurchaseConversionHint);
function renderInventory(){
  const rows=Object.values(db.inventory).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN'));
  $('#inventoryList').innerHTML=rows.length?rows.map(p=>`<div class="stock-row inventory-row"><div class="activity-main"><span class="row-title">${safe(p.name)}</span><span class="row-sub">库存单位：${safe(p.unit)} · 补货提醒：${p.threshold==null?'未设置':`${p.threshold} ${safe(p.unit)}`}</span></div><div class="inventory-remaining"><small>当前剩余</small><strong>${p.qty} ${safe(p.unit)}</strong>${p.threshold!=null&&p.qty<=p.threshold?'<em>需补货</em>':''}</div><button class="edit-record" data-product-id="${safe(p.id)}">编辑</button></div>`).join(''):'<div class="empty-state">还没有库存记录，记一笔采购后会自动入库</div>';
  $$('#inventoryList [data-product-id]').forEach(b=>b.addEventListener('click',()=>openProductEdit(b.dataset.productId)));
}
function renderPurchaseList(){
  const rows=[...db.purchases].sort((a,b)=>b.date.localeCompare(a.date)||(b.createdAt||'').localeCompare(a.createdAt||''));
  $('#purchaseList').innerHTML=rows.length?rows.map(p=>`<div class="activity-row record-row"><div class="activity-main"><span class="row-title">${safe(p.date)} · ${safe(p.name)}</span><span class="row-sub">${p.qty} ${safe(p.unit)} · ${safe(p.supplier||'未填写供应商')} · ${money(p.unitCost)}/${safe(p.unit)}</span></div><div class="stock-amount">${money(purchaseTotal(p))}</div><div class="record-actions"><button class="edit-record" data-purchase-edit="${safe(p.recordId||p.id)}">修改</button><button class="delete-record" data-purchase-delete="${safe(p.recordId||p.id)}">删除</button></div></div>`).join(''):'<div class="empty-state">还没有采购记录</div>';
  $$('#purchaseList [data-purchase-edit]').forEach(b=>b.addEventListener('click',()=>editPurchase(b.dataset.purchaseEdit)));
  $$('#purchaseList [data-purchase-delete]').forEach(b=>b.addEventListener('click',()=>deleteRecord('purchase',b.dataset.purchaseDelete)));
}
function renderExpenseList(){
  const rows=[...db.expenses].sort((a,b)=>b.date.localeCompare(a.date)||(b.createdAt||'').localeCompare(a.createdAt||''));
  $('#expenseList').innerHTML=rows.length?rows.map(e=>`<div class="activity-row record-row"><div class="activity-main"><span class="row-title">${safe(e.date)} · ${safe(e.item)}</span><span class="row-sub">${safe(e.category)}${e.note?' · '+safe(e.note):''}</span></div><div class="stock-amount">${money(e.amount)}</div><div class="record-actions"><button class="edit-record" data-expense-edit="${safe(e.recordId)}">修改</button><button class="delete-record" data-expense-delete="${safe(e.recordId)}">删除</button></div></div>`).join(''):'<div class="empty-state">还没有其他支出记录</div>';
  $$('#expenseList [data-expense-edit]').forEach(b=>b.addEventListener('click',()=>editExpense(b.dataset.expenseEdit)));
  $$('#expenseList [data-expense-delete]').forEach(b=>b.addEventListener('click',()=>deleteRecord('expense',b.dataset.expenseDelete)));
}
function renderStocktakeList(){
  const rows=[...db.adjustments].sort((a,b)=>b.date.localeCompare(a.date)||(b.createdAt||'').localeCompare(a.createdAt||''));
  $('#stocktakeList').innerHTML=rows.length?rows.map(a=>`<div class="activity-row record-row"><div class="activity-main"><span class="row-title">${safe(a.date)} · ${safe(a.name)}</span><span class="row-sub">实盘剩余 ${a.inputQty??a.actual??'—'} ${safe(a.inputUnit||db.inventory[a.id]?.unit||'')}${a.inputUnit&&a.inputUnit!==db.inventory[a.id]?.unit?`（入库 ${a.actual} ${safe(db.inventory[a.id]?.unit||'')}）`:''} · 账面差异 ${a.qty>0?'+':''}${a.qty} ${safe(db.inventory[a.id]?.unit||'')}${a.note?' · '+safe(a.note):''}</span></div><div class="record-actions"><button class="edit-record" data-stocktake-edit="${safe(a.recordId||a.id)}">修改</button><button class="delete-record" data-stocktake-delete="${safe(a.recordId||a.id)}">删除</button></div></div>`).join(''):'<div class="empty-state">还没有盘点记录</div>';
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
function renderWeekTrend(){
  const end=parseDate(dashboardDate),rows=[];
  for(let offset=6;offset>=0;offset--){const date=new Date(end);date.setDate(end.getDate()-offset);const key=dateString(date);rows.push({key,day:`${date.getMonth()+1}/${date.getDate()}`,...dailyTotals(key)});}
  const max=Math.max(1,...rows.flatMap(r=>[r.income,r.expense]));
  $('#weekTrend').innerHTML=`<div class="trend-legend"><span class="legend-income">● 收入</span><span class="legend-expense">● 支出</span><span>截至 ${safe(dashboardDate)}</span></div><div class="trend-bars">${rows.map(r=>`<div class="trend-day" title="${safe(r.key)}：收入${money(r.income)}，支出${money(r.expense)}，结余${money(r.net)}"><div class="trend-pair"><i class="trend-income-bar" style="height:${r.income?Math.max(4,r.income/max*100):0}%"></i><i class="trend-expense-bar" style="height:${r.expense?Math.max(4,r.expense/max*100):0}%"></i></div><small>${r.day}</small></div>`).join('')}</div><p class="trend-foot">7 天收入 ${money(rows.reduce((s,r)=>s+r.income,0))} · 支出 ${money(rows.reduce((s,r)=>s+r.expense,0))}</p>`;
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
  db.expenses.forEach(e=>items.push({date:e.date,kind:`${e.category} · ${e.item}`,sub:e.note||'其他支出',amount:num(e.amount),sign:'−',type:'expense',id:e.recordId}));
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
  if(type==='expense')db.expenses=db.expenses.filter(e=>e.recordId!==id);
  if(type==='adjustment'){const index=db.adjustments.findIndex(a=>(a.recordId||a.id)===id);if(index>=0){const productId=db.adjustments[index].id;db.adjustments.splice(index,1);recalculateInventory(productId);}}
  if(type==='loss'){const index=db.losses.findIndex(a=>a.recordId===id);if(index>=0){const productId=db.losses[index].id;db.losses.splice(index,1);recalculateInventory(productId);}}
  saveDB();toast('记录已删除');
}
function recalculateInventory(productId){
  const product=db.inventory[productId];if(!product)return;
  const events=[...db.purchases.filter(p=>p.id===productId).map(p=>({date:p.date,time:p.createdAt||`${p.date}T00:00:00`,type:0,qty:convertQty(p.qty,p.unit||product.unit,product.unit)??0})),...db.losses.filter(a=>a.id===productId).map(a=>({date:a.date,time:a.createdAt||`${a.date}T12:00:00`,type:1,qty:num(a.qty)})),...db.adjustments.filter(a=>a.id===productId).map(a=>({date:a.date,time:a.createdAt||`${a.date}T23:59:59`,type:2,source:a,actual:a.actual,qty:num(a.qty)}))].sort((a,b)=>a.date.localeCompare(b.date)||a.time.localeCompare(b.time)||a.type-b.type);
  let qty=0;events.forEach(e=>{if(e.type===0)qty+=e.qty;else if(e.type===1)qty-=e.qty;else if(e.actual==null)qty+=e.qty;else{e.source.qty=roundQty(num(e.actual)-qty);qty=num(e.actual);}});product.qty=roundQty(qty);
}
function activateTab(name){ $('.app-shell').classList.toggle('show-home',name==='overview');$$('.tab').forEach(t=>t.classList.toggle('active',t.dataset.tab===name)); $$('.view').forEach(v=>v.classList.toggle('active',v.id===`view-${name}`)); window.scrollTo({top:0,behavior:'smooth'}); }
$$('.tab').forEach(t=>t.addEventListener('click',()=>activateTab(t.dataset.tab)));
$$('[data-open]').forEach(b=>b.addEventListener('click',()=>{if(b.dataset.open==='income'){$('#incomeForm [name=date]').value=dashboardDate;loadIncomeDate();}activateTab(b.dataset.open);}));
$$('[data-tab-link]').forEach(b=>b.addEventListener('click',()=>activateTab(b.dataset.tabLink)));
$('#openIncomeSummary').addEventListener('click',()=>{$('#incomeForm [name=date]').value=dashboardDate;loadIncomeDate();activateTab('income');});
$('#openExpenseSummary').addEventListener('click',()=>{activateTab('expenses');});
$('#openInventorySummary').addEventListener('click',()=>{activateTab('inventory');});
$('#todayLabel').addEventListener('click',()=>{$('#dateForm [name=date]').value=dashboardDate;$('#dateDialog').showModal();});
$('.close-date').addEventListener('click',()=>$('#dateDialog').close());
$('#dateForm').addEventListener('submit',e=>{e.preventDefault();dashboardDate=e.currentTarget.elements.date.value;selectedDate=dashboardDate;render();$('#dateDialog').close();});

$('#incomeForm').addEventListener('submit',e=>{
  e.preventDefault(); const f=new FormData(e.currentTarget), date=f.get('date');
  db.incomes[date]={cash:num(f.get('cash')),wechat:num(f.get('wechat')),alipay:num(f.get('alipay')),note:f.get('note').trim(),updatedAt:new Date().toISOString()};
  saveDB();loadIncomeDate(); toast('当天收入已保存');
});
function loadIncomeDate(){
  const form=$('#incomeForm'),record=db.incomes[form.elements.date.value]||{};
  for(const key of ['cash','wechat','alipay'])form.elements[key].value=record[key]??'';
  form.elements.note.value=record.note||'';
  $('#incomeSubmit').textContent=db.incomes[form.elements.date.value]?'保存当天修改':'保存当天收入';
  $('#cancelIncomeEdit').classList.toggle('hidden',!db.incomes[form.elements.date.value]);
}
$('#incomeForm [name=date]').addEventListener('change',loadIncomeDate);
$('#cancelIncomeEdit').addEventListener('click',()=>{$('#incomeForm [name=date]').value=today();loadIncomeDate();});

function resetPurchaseEdit(){
  editingPurchaseRecordId=null;const form=$('#purchaseForm');form.reset();form.elements.productId.disabled=false;
  $('#purchaseSubmit').textContent='保存采购并入库';$('#purchaseEditNotice').classList.add('hidden');$('#cancelPurchaseEdit').classList.add('hidden');setTodayInputs();updatePurchaseProduct();
}
function editPurchase(id){
  const p=db.purchases.find(x=>(x.recordId||x.id)===id);if(!p)return;
  editingPurchaseRecordId=id;const form=$('#purchaseForm');
  for(const [name,value] of Object.entries({date:p.date,supplier:p.supplier,productId:p.id,unit:p.unit,qty:p.qty,unitCost:p.unitCost,threshold:db.inventory[p.id]?.threshold??'',extraCost:p.extraCost,note:p.note}))form.elements[name].value=value??'';
  updatePurchaseProduct();form.elements.unit.value=p.unit;updatePurchaseConversionHint();
  form.elements.productId.disabled=true;$('#purchaseSubmit').textContent='保存采购修改';$('#purchaseEditNotice').classList.remove('hidden');$('#cancelPurchaseEdit').classList.remove('hidden');form.scrollIntoView({behavior:'smooth',block:'start'});
}
$('#cancelPurchaseEdit').addEventListener('click',resetPurchaseEdit);

$('#purchaseForm').addEventListener('submit',e=>{
  e.preventDefault();const form=e.currentTarget,f=new FormData(form),id=editingPurchaseRecordId?db.purchases.find(p=>(p.recordId||p.id)===editingPurchaseRecordId)?.id:f.get('productId'),product=db.inventory[id];
  if(!product){toast('请先选择或新增原料');return;}
  const unit=f.get('unit'),converted=convertQty(f.get('qty'),unit,product.unit);
  if(converted==null){toast('采购单位与库存单位不匹配');return;}
  const fields={date:f.get('date'),supplier:f.get('supplier').trim(),qty:num(f.get('qty')),unit,unitCost:num(f.get('unitCost')),extraCost:num(f.get('extraCost')),note:f.get('note').trim()};
  product.threshold=f.get('threshold')===''?null:num(f.get('threshold'));
  if(editingPurchaseRecordId){const p=db.purchases.find(x=>(x.recordId||x.id)===editingPurchaseRecordId);Object.assign(p,fields,{threshold:product.threshold});recalculateInventory(id);resetPurchaseEdit();saveDB();toast('采购记录已修改');return;}
  db.purchases.push({recordId:crypto.randomUUID(),createdAt:new Date().toISOString(),id,name:product.name,threshold:product.threshold,...fields});recalculateInventory(id);resetPurchaseEdit();saveDB();toast('采购已保存，库存已增加');
});

function resetExpenseEdit(){
  editingExpenseRecordId=null;const form=$('#expenseForm');form.reset();form.elements.date.value=today();
  $('#expenseSubmit').textContent='保存支出';$('#cancelExpenseEdit').classList.add('hidden');
}
function editExpense(id){
  const record=db.expenses.find(e=>e.recordId===id);if(!record)return;
  editingExpenseRecordId=id;activateTab('expenses');const form=$('#expenseForm');
  for(const key of ['date','category','item','amount','note'])form.elements[key].value=record[key]??'';
  $('#expenseSubmit').textContent='保存支出修改';$('#cancelExpenseEdit').classList.remove('hidden');
  form.scrollIntoView({behavior:'smooth',block:'start'});
}
$('#cancelExpenseEdit').addEventListener('click',resetExpenseEdit);
$('#addExpenseCategory').addEventListener('click',()=>{$('#expenseCategoryForm').reset();$('#expenseCategoryDialog').showModal();});
$('.close-expense-category').addEventListener('click',()=>$('#expenseCategoryDialog').close());
$('#expenseCategoryForm').addEventListener('submit',e=>{e.preventDefault();const name=e.currentTarget.elements.name.value.trim();if(!name)return;if(db.expenseCategories.some(category=>category.toLowerCase()===name.toLowerCase())){toast('这个分类已存在');return;}db.expenseCategories.push(name);saveDB();$('#expenseForm [name=category]').value=name;$('#expenseCategoryDialog').close();toast('支出分类已加入选项');});
$('#expenseForm').addEventListener('submit',e=>{
  e.preventDefault();const form=e.currentTarget,f=new FormData(form);
  const fields={date:f.get('date'),category:f.get('category'),item:f.get('item').trim(),amount:num(f.get('amount')),note:f.get('note').trim()};
  if(!fields.date||!fields.item||fields.amount<=0){toast('请填写日期、项目和大于零的金额');return;}
  if(editingExpenseRecordId){Object.assign(db.expenses.find(e=>e.recordId===editingExpenseRecordId),fields);saveDB();resetExpenseEdit();toast('支出记录已修改');return;}
  db.expenses.push({recordId:crypto.randomUUID(),createdAt:new Date().toISOString(),...fields});saveDB();resetExpenseEdit();toast('支出已保存');
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
  const p=db.inventory[id];if(!p)return;editingProductId=id;const form=$('#productForm');form.elements.name.value=p.name;form.elements.unit.value=p.unit;form.elements.unit.dataset.previousUnit=p.unit;form.elements.threshold.value=p.threshold??'';$('#productThresholdUnit').textContent=p.unit;$('#productDialog').showModal();
}
$('.close-product').addEventListener('click',()=>$('#productDialog').close());
$('#productForm [name=unit]').addEventListener('change',e=>{const select=e.target,oldUnit=select.dataset.previousUnit,newUnit=select.value,threshold=$('#productForm [name=threshold]');if(threshold.value!==''){const converted=convertQty(threshold.value,oldUnit,newUnit);if(converted!=null)threshold.value=converted;}select.dataset.previousUnit=newUnit;$('#productThresholdUnit').textContent=newUnit||'单位';});
$('#productForm').addEventListener('submit',e=>{
  e.preventDefault();const p=db.inventory[editingProductId];if(!p)return;const f=new FormData(e.currentTarget),name=f.get('name').trim(),unit=f.get('unit');
  if(Object.values(db.inventory).some(x=>x.id!==p.id&&x.name.toLowerCase()===name.toLowerCase())){toast('已有同名原料，请换一个名称');return;}
  const oldUnit=p.unit,ratio=convertQty(1,oldUnit,unit),hasHistory=db.purchases.some(x=>x.id===p.id)||db.adjustments.some(x=>x.id===p.id)||db.losses.some(x=>x.id===p.id);
  if(oldUnit!==unit&&ratio==null&&hasHistory){toast('已有记录的原料只能改成可换算的单位');return;}
  if(oldUnit!==unit&&ratio!=null){p.qty=roundQty(num(p.qty)*ratio);db.adjustments.filter(x=>x.id===p.id).forEach(x=>{x.qty=roundQty(num(x.qty)*ratio);if(x.actual!=null)x.actual=roundQty(num(x.actual)*ratio);});db.losses.filter(x=>x.id===p.id).forEach(x=>x.qty=roundQty(num(x.qty)*ratio));}
  Object.assign(p,{name,unit,threshold:f.get('threshold')===''?null:num(f.get('threshold'))});db.purchases.filter(x=>x.id===p.id).forEach(x=>x.name=name);db.adjustments.filter(x=>x.id===p.id).forEach(x=>x.name=name);db.losses.filter(x=>x.id===p.id).forEach(x=>x.name=name);
  if(oldUnit!==unit)recalculateInventory(p.id);
  saveDB();$('#productDialog').close();editingProductId=null;toast('原料信息已修改');
});
$('#deleteProduct').addEventListener('click',()=>{
  const id=editingProductId;if(!id)return;
  if(db.purchases.some(p=>p.id===id)||db.adjustments.some(a=>a.id===id)||db.losses.some(a=>a.id===id)){toast('请先删除该原料的采购、盘点和损耗记录');return;}
  if(!confirm('确定删除这个原料吗？'))return;delete db.inventory[id];editingProductId=null;saveDB();$('#productDialog').close();toast('原料已删除');
});

function populateStocktakeProducts(selectedId){
  const select=$('#adjustForm [name=product]');select.innerHTML=Object.values(db.inventory).map(p=>`<option value="${safe(p.id)}">${safe(p.name)}（现有 ${p.qty} ${safe(p.unit)}）</option>`).join('');
  if(selectedId)select.value=selectedId;updateStocktakeUnit();
}
function updateStocktakeUnit(preferredUnit){const form=$('#adjustForm'),p=db.inventory[form.elements.product.value],select=form.elements.unit;select.innerHTML=p?unitOptions(p.unit):'';if(p)select.value=unitChoices(p.unit).some(([unit])=>unit===preferredUnit)?preferredUnit:p.unit;updateStocktakeEquivalent();}
function updateStocktakeEquivalent(){const form=$('#adjustForm'),p=db.inventory[form.elements.product.value],qty=form.elements.qty.value,unit=form.elements.unit.value,target=$('#stocktakeEquivalent');target.textContent=!p?'先选择原料。':qty===''?`可按 ${unitChoices(p.unit).map(([u])=>u).join(' / ')} 盘点；库存统一显示为 ${p.unit}。`:`盘点 ${qty} ${unit} = 库存 ${convertQty(qty,unit,p.unit)} ${p.unit}。`;}
$('#adjustForm [name=product]').addEventListener('change',()=>updateStocktakeUnit());
$('#adjustForm [name=unit]').addEventListener('change',updateStocktakeEquivalent);
$('#adjustForm [name=qty]').addEventListener('input',updateStocktakeEquivalent);
function openStocktake(date=today()){
  const products=Object.values(db.inventory); if(!products.length){toast('先新增原料并记录采购');return;}
  editingAdjustmentRecordId=null;const form=$('#adjustForm');form.reset();form.elements.date.value=date;form.elements.product.disabled=false;populateStocktakeProducts();$('#adjustDialog').showModal();
}
$('#adjustStock').addEventListener('click',()=>openStocktake());
$('#quickStocktake').addEventListener('click',()=>openStocktake());
function editStocktake(id){
  const a=db.adjustments.find(x=>(x.recordId||x.id)===id);if(!a)return;editingAdjustmentRecordId=id;const form=$('#adjustForm');form.elements.date.value=a.date;form.elements.product.innerHTML=`<option value="${safe(a.id)}">${safe(a.name)}</option>`;form.elements.product.value=a.id;form.elements.product.disabled=true;form.elements.qty.value=a.inputQty??a.actual??'';form.elements.note.value=a.note||'';updateStocktakeUnit(a.inputUnit);$('#adjustDialog').showModal();
}
$('.close-button').addEventListener('click',()=>$('#adjustDialog').close());
$('#adjustDialog').addEventListener('close',()=>{editingAdjustmentRecordId=null;$('#adjustForm').reset();$('#adjustForm [name=product]').disabled=false;});
$('#adjustForm').addEventListener('submit',e=>{
  e.preventDefault(); const f=new FormData(e.currentTarget), id=editingAdjustmentRecordId?db.adjustments.find(a=>(a.recordId||a.id)===editingAdjustmentRecordId)?.id:f.get('product'),p=db.inventory[id]; if(!p)return;
  const inputQty=num(f.get('qty')),inputUnit=f.get('unit'),actual=convertQty(inputQty,inputUnit,p.unit);if(actual==null){toast('盘点单位与库存单位不匹配');return;}
  if(editingAdjustmentRecordId){const a=db.adjustments.find(x=>(x.recordId||x.id)===editingAdjustmentRecordId);Object.assign(a,{date:f.get('date'),actual,inputQty,inputUnit,note:f.get('note').trim()});recalculateInventory(id);saveDB();$('#adjustDialog').close();toast('盘点记录已修改');return;}
  db.adjustments.push({recordId:crypto.randomUUID(),createdAt:new Date().toISOString(),date:f.get('date'),id:p.id,name:p.name,qty:0,actual,inputQty,inputUnit,note:f.get('note').trim()});recalculateInventory(id);saveDB();$('#adjustDialog').close();e.currentTarget.reset();toast('盘点结果已保存');
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
function activityOn(d){return Boolean(db.incomes[d]||db.purchases.some(p=>p.date===d)||db.expenses.some(e=>e.date===d)||db.adjustments.some(a=>a.date===d)||db.losses.some(a=>a.date===d));}
function monthTitle(d){return `${d.getFullYear()}年${d.getMonth()+1}月`;}
function weekBounds(d){const start=new Date(d);start.setDate(start.getDate()-((start.getDay()+6)%7));const end=new Date(start);end.setDate(start.getDate()+6);return [start,end];}
function periodBounds(){const d=parseDate(selectedDate);if(activePeriod==='day')return[d,d];if(activePeriod==='week')return weekBounds(d);if(activePeriod==='month')return[new Date(d.getFullYear(),d.getMonth(),1),new Date(d.getFullYear(),d.getMonth()+1,0)];return[new Date(d.getFullYear(),0,1),new Date(d.getFullYear(),11,31)];}
function dailyTotals(d){const i=dateRecord(d), purchases=db.purchases.filter(p=>p.date===d).reduce((s,p)=>s+purchaseTotal(p),0), other=db.expenses.filter(e=>e.date===d).reduce((s,e)=>s+num(e.amount),0), income=totalIncome(i);return {cash:num(i.cash),wechat:num(i.wechat),alipay:num(i.alipay),income,purchases,other,expense:purchases+other,net:income-purchases-other};}
function shortAmount(n){return Number(n).toLocaleString('en-US',{minimumFractionDigits:0,maximumFractionDigits:2});}
function specialKind(category){return ({'学校放假':'school-break','学校活动':'school-event','节假日':'holiday','天气影响':'weather','市集/集会':'market','其他':'other'})[category]||'other';}
function calendarDayMarkup(date,inPeriod=true){
  const key=dateString(date),tot=dailyTotals(key),event=db.specialDays[key],loss=db.losses.some(a=>a.date===key);
  return `<button class="calendar-day ${inPeriod?'':'outside'} ${key===calendarDate?'selected':''} ${key===today()?'today':''} ${activityOn(key)?'has-record':''} ${event?`special-day special-kind-${specialKind(event.category)}`:''}" data-date="${key}" title="${event?safe(event.category+' · '+event.title):key}" aria-label="${key}${event?'，'+safe(event.title):''}，收入${money(tot.income)}，支出${money(tot.expense)}${loss?'，有额外损耗':''}"><b>${date.getDate()}</b><span class="calendar-event-slot">${event?`<em class="calendar-event">${safe(event.title)}</em>`:''}</span><span class="calendar-amounts">${tot.income?`<small class="calendar-income">+${shortAmount(tot.income)}</small>`:''}${tot.expense?`<small class="calendar-expense">−${shortAmount(tot.expense)}</small>`:''}${loss?'<small class="calendar-loss">•损耗</small>':''}</span></button>`;
}
function renderCalendar(){
  const chosen=parseDate(calendarDate),grid=$('#calendarGrid'),weekdays=$('#calendarWeekdays');
  $('#homeCalendarTitle').textContent=calendarPeriod==='year'?`${chosen.getFullYear()}年`:calendarPeriod==='day'?`${monthTitle(chosen)}${chosen.getDate()}日`:calendarPeriod==='week'?`${weekBounds(chosen).map(dateString).join(' 至 ')}`:monthTitle(chosen);
  grid.className=`calendar-grid calendar-view-${calendarPeriod}`;weekdays.classList.toggle('hidden',calendarPeriod==='day'||calendarPeriod==='year');
  if(calendarPeriod==='year'){
    grid.innerHTML=Array.from({length:12},(_,m)=>{const first=new Date(chosen.getFullYear(),m,1),last=new Date(chosen.getFullYear(),m+1,0);let income=0,expense=0;for(let d=new Date(first);d<=last;d.setDate(d.getDate()+1)){const t=dailyTotals(dateString(d));income+=t.income;expense+=t.expense;}return `<button class="calendar-month" data-month="${m}" type="button"><b>${m+1}月</b><small class="calendar-income">+${shortAmount(income)}</small><small class="calendar-expense">−${shortAmount(expense)}</small></button>`;}).join('');
    $$('.calendar-month',grid).forEach(b=>b.addEventListener('click',()=>{calendarDate=dateString(new Date(chosen.getFullYear(),Number(b.dataset.month),1));calendarPeriod='month';syncCalendarPeriodButtons();renderCalendar();}));return;
  }
  let start,end;if(calendarPeriod==='day'){start=new Date(chosen);end=new Date(chosen);}else if(calendarPeriod==='week'){[start,end]=weekBounds(chosen);}else{const first=new Date(chosen.getFullYear(),chosen.getMonth(),1);start=new Date(first);start.setDate(first.getDate()-((first.getDay()+6)%7));const last=new Date(chosen.getFullYear(),chosen.getMonth()+1,0);end=new Date(last);end.setDate(last.getDate()+(7-((last.getDay()+6)%7)-1));}
  const html=[];for(let d=new Date(start);d<=end;d.setDate(d.getDate()+1))html.push(calendarDayMarkup(d,calendarPeriod!=='month'||d.getMonth()===chosen.getMonth()));
  grid.innerHTML=html.join('');$$('.calendar-day',grid).forEach(b=>b.addEventListener('click',()=>openCalendarActions(b.dataset.date)));
}
let calendarActionDate=today();
function openCalendarActions(date){calendarActionDate=date;calendarDate=date;renderCalendar();const totals=dailyTotals(date);$('#calendarActionTitle').textContent=`${date} · 记录这一天`;$('#calendarActionSummary').textContent=`收入 ${money(totals.income)} · 支出 ${money(totals.expense)}${db.specialDays[date]?` · ${db.specialDays[date].title}`:''}`;$('#calendarSpecialActionLabel').textContent=db.specialDays[date]?'查看／修改特别日期':'标记特别日期';$('#calendarActionDialog').showModal();}
$('.close-calendar-action').addEventListener('click',()=>$('#calendarActionDialog').close());
$$('[data-calendar-action]').forEach(button=>button.addEventListener('click',()=>{const date=calendarActionDate,action=button.dataset.calendarAction;$('#calendarActionDialog').close();if(action==='income'){$('#incomeForm [name=date]').value=date;loadIncomeDate();activateTab('income');}if(action==='expense'){$('#purchaseForm [name=date]').value=date;$('#expenseForm [name=date]').value=date;activateTab('expenses');}if(action==='stocktake')openStocktake(date);if(action==='special')openSpecialDay(date);}));
function syncCalendarPeriodButtons(){$$('[data-calendar-period]').forEach(b=>b.classList.toggle('active',b.dataset.calendarPeriod===calendarPeriod));}
$$('[data-calendar-period]').forEach(b=>b.addEventListener('click',()=>{calendarPeriod=b.dataset.calendarPeriod;syncCalendarPeriodButtons();renderCalendar();}));
function shiftCalendar(direction){const d=parseDate(calendarDate);if(calendarPeriod==='day')d.setDate(d.getDate()+direction);else if(calendarPeriod==='week')d.setDate(d.getDate()+7*direction);else if(calendarPeriod==='month')d.setMonth(d.getMonth()+direction,1);else d.setFullYear(d.getFullYear()+direction);calendarDate=dateString(d);renderCalendar();}
$('#homeCalendarPrev').addEventListener('click',()=>shiftCalendar(-1));$('#homeCalendarNext').addEventListener('click',()=>shiftCalendar(1));
function renderReportTrend(start,end){
  const rows=[];
  if(activePeriod==='year'){
    for(let month=0;month<12;month++){const first=new Date(start.getFullYear(),month,1),last=new Date(start.getFullYear(),month+1,0);let income=0,expense=0;for(let d=new Date(first);d<=last;d.setDate(d.getDate()+1)){const t=dailyTotals(dateString(d));income+=t.income;expense+=t.expense;}rows.push({label:`${month+1}月`,income,expense,net:income-expense});}
  }else{
    for(let d=new Date(start);d<=end;d.setDate(d.getDate()+1)){const t=dailyTotals(dateString(d));rows.push({label:activePeriod==='day'?`${d.getMonth()+1}/${d.getDate()}`:String(d.getDate()),...t});}
  }
  const values=rows.map(r=>r[reportChartMetric]),width=Math.max(300,rows.length*27),metricName={income:'收入',expense:'支出',net:'结余'}[reportChartMetric];
  const chart=reportChartStyle==='bar'?(()=>{const max=Math.max(1,...values.map(Math.abs));return `<div class="report-chart-scroll"><div class="report-bars" style="width:${width}px">${rows.map((r,i)=>`<div class="report-chart-day" title="${safe(r.label)} ${metricName} ${money(values[i])}"><div class="report-bar-track"><i class="metric-${reportChartMetric} ${values[i]<0?'negative':''}" style="height:${values[i]?Math.max(3,Math.abs(values[i])/max*100):0}%"></i></div><small>${safe(r.label)}</small></div>`).join('')}</div></div>`;})():(()=>{const max=Math.max(0,...values),min=Math.min(0,...values),range=max-min||1,top=16,plotHeight=130,step=rows.length>1?(width-32)/(rows.length-1):0;const pts=values.map((v,i)=>`${16+i*step},${top+(max-v)/range*plotHeight}`).join(' ');const zero=top+max/range*plotHeight;return `<div class="report-chart-scroll"><svg class="report-line metric-${reportChartMetric}" viewBox="0 0 ${width} 185" style="width:${width}px" role="img" aria-label="${metricName}趋势折线图"><line x1="0" x2="${width}" y1="${zero}" y2="${zero}" class="chart-zero"/><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>${values.map((v,i)=>`<circle cx="${16+i*step}" cy="${top+(max-v)/range*plotHeight}" r="3" fill="currentColor"><title>${safe(rows[i].label)} ${metricName} ${money(v)}</title></circle><text x="${16+i*step}" y="178" text-anchor="middle">${rows.length>16&&i%5!==0?'':safe(rows[i].label)}</text>`).join('')}</svg></div>`;})();
  $('#reportTrend').innerHTML=`<div class="chart-caption">${metricName}合计 <strong>${money(values.reduce((s,v)=>s+v,0))}</strong></div>${chart}`;
}
$$('[data-chart-style]').forEach(b=>b.addEventListener('click',()=>{reportChartStyle=b.dataset.chartStyle;$$('[data-chart-style]').forEach(x=>x.classList.toggle('active',x===b));renderReports();}));
$$('[data-chart-metric]').forEach(b=>b.addEventListener('click',()=>{reportChartMetric=b.dataset.chartMetric;$$('[data-chart-metric]').forEach(x=>x.classList.toggle('active',x===b));renderReports();}));
function renderReports(){
  const chosen=parseDate(selectedDate);
  $('#calendarTitle').textContent=activePeriod==='year'?`${chosen.getFullYear()}年`:activePeriod==='day'?`${monthTitle(chosen)}${chosen.getDate()}日`:activePeriod==='week'?`${weekBounds(chosen).map(dateString).join(' 至 ')}`:monthTitle(chosen);
  const [start,end]=periodBounds(), startKey=dateString(start),endKey=dateString(end),dates=Object.keys(db.incomes).concat(db.purchases.map(p=>p.date),db.expenses.map(e=>e.date),db.adjustments.map(a=>a.date),db.losses.map(a=>a.date),Object.keys(db.specialDays)).filter((v,i,a)=>a.indexOf(v)===i&&v>=startKey&&v<=endKey).sort();
  const totals=dates.reduce((acc,d)=>{const x=dailyTotals(d);for(const k of Object.keys(acc))acc[k]+=x[k];return acc;},{cash:0,wechat:0,alipay:0,income:0,purchases:0,other:0,expense:0,net:0});
  if(activePeriod==='day'&&!dates.includes(selectedDate)){const x=dailyTotals(selectedDate);Object.assign(totals,x);}
  $('#reportOverviewTitle').textContent=`${$('#calendarTitle').textContent}收支总览`;
  $('#periodSummary').innerHTML=`<div class="report-metric"><span>收入</span><b>${money(totals.income)}</b></div><div class="report-metric"><span>支出</span><b>${money(totals.expense)}</b></div><div class="report-metric"><span>结余</span><b>${money(totals.net)}</b></div><div class="report-channels">${[['现金',totals.cash],['微信',totals.wechat],['支付宝',totals.alipay]].map(([n,v])=>`<div class="channel-box"><span>${n}</span><b>${money(v)}</b></div>`).join('')}</div>`;
  const dailyBreakdown=$('#dailyExpenseBreakdown');dailyBreakdown.classList.toggle('hidden',activePeriod!=='day');if(activePeriod==='day'){const x=dailyTotals(selectedDate);dailyBreakdown.innerHTML=`<div class="stock-row"><span class="row-title">采购支出</span><strong>${money(x.purchases)}</strong></div><div class="stock-row"><span class="row-title">其他日常支出</span><strong>${money(x.other)}</strong></div>`;}
  $('#breakdownTitle').textContent=activePeriod==='year'?'每月账单汇总':activePeriod==='day'?'当日账单':'每日账单汇总';
  let buckets=[];
  if(activePeriod==='year'){
    for(let m=0;m<12;m++){const ym=`${selectedDate.slice(0,4)}-${String(m+1).padStart(2,'0')}`, ds=dates.filter(d=>d.startsWith(ym));if(ds.length){const x=ds.reduce((a,d)=>{const t=dailyTotals(d);for(const k of Object.keys(a))a[k]+=t[k];return a;},{cash:0,wechat:0,alipay:0,income:0,purchases:0,other:0,expense:0,net:0});buckets.push({label:`${m+1}月`,sub:`${ds.length} 天有记录 · 现金 ${money(x.cash)} / 微信 ${money(x.wechat)} / 支付宝 ${money(x.alipay)}`,...x});}}
  }else {const list=activePeriod==='day'?[selectedDate]:dates; buckets=list.map(d=>({label:d,sub:`现金 ${money(dailyTotals(d).cash)} · 微信 ${money(dailyTotals(d).wechat)} · 支付宝 ${money(dailyTotals(d).alipay)}`,...dailyTotals(d)}));}
  $('#periodRows').innerHTML=buckets.length?buckets.reverse().map(x=>`<div class="bill-row"><span>${safe(x.label)}</span><strong class="bill-income">${money(x.income)}</strong><strong class="bill-expense">${money(x.expense)}</strong><strong>${money(x.net)}</strong></div>`).join(''):'<div class="empty-state">这个周期还没有经营记录</div>';
  renderReportTrend(start,end);
  renderAnalysis(dates,totals,startKey,endKey);
}
function renderSpecialDayForm(){
  const event=db.specialDays[markedDate],form=$('#specialDayForm'),tot=dailyTotals(markedDate);
  $('#specialDateTitle').textContent=`${markedDate} · ${event?'已标记':'标记特别日期'}`;
  $('#specialDaySummary').textContent=`收入 ${money(tot.income)} · 支出 ${money(tot.expense)} · 结余 ${money(tot.net)}`;
  form.elements.date.value=markedDate;form.elements.category.value=event?.category||'学校放假';form.elements.title.value=event?.title||'';form.elements.note.value=event?.note||'';$('#deleteSpecialDay').classList.toggle('hidden',!event);
  updateSpecialDialogColor();
}
function updateSpecialDialogColor(){$('#specialDayDialog').dataset.specialKind=specialKind($('#specialDayForm [name=category]').value);}
function openSpecialDay(date){markedDate=date;calendarDate=date;renderCalendar();renderSpecialDayForm();$('#specialDayDialog').showModal();}
$('.close-special-date').addEventListener('click',()=>$('#specialDayDialog').close());
$('#specialDayForm [name=category]').addEventListener('change',updateSpecialDialogColor);
$('#specialDayForm [name=date]').addEventListener('change',e=>{if(!e.target.value)return;markedDate=e.target.value;calendarDate=markedDate;renderCalendar();renderSpecialDayForm();});
$('#specialDayForm').addEventListener('submit',e=>{
  e.preventDefault();const f=new FormData(e.currentTarget);markedDate=f.get('date');calendarDate=markedDate;db.specialDays[markedDate]={category:f.get('category'),title:f.get('title').trim(),note:f.get('note').trim()};saveDB();$('#specialDayDialog').close();toast('特别日期已保存');
});
$('#deleteSpecialDay').addEventListener('click',()=>{if(!db.specialDays[markedDate])return;if(!confirm('确定删除这一天的特别日期标记吗？'))return;delete db.specialDays[markedDate];saveDB();$('#specialDayDialog').close();toast('日期标记已删除');});
function renderAnalysis(dates,totals,startKey,endKey){
  const incomeDates=dates.filter(d=>db.incomes[d]), activeCount=incomeDates.length, avg=activeCount?totals.income/activeCount:0;
  const best=incomeDates.map(d=>({date:d,income:totalIncome(db.incomes[d])})).sort((a,b)=>b.income-a.income)[0];
  const channelEntries=[['现金',totals.cash],['微信',totals.wechat],['支付宝',totals.alipay]].sort((a,b)=>b[1]-a[1]);
  const top=channelEntries[0],share=totals.income?Math.round(top[1]/totals.income*100):0;
  const allSpecial=incomeDates.filter(d=>db.specialDays[d]),ordinary=incomeDates.filter(d=>!db.specialDays[d]);
  const specialCategories=[...new Set(allSpecial.map(d=>db.specialDays[d].category))];if(!specialCategories.includes(comparisonCategory))comparisonCategory=specialCategories[0]||'';
  const special=allSpecial.filter(d=>db.specialDays[d].category===comparisonCategory);
  const specialAvg=special.length?special.reduce((s,d)=>s+totalIncome(db.incomes[d]),0)/special.length:0;
  const ordinaryAvg=ordinary.length?ordinary.reduce((s,d)=>s+totalIncome(db.incomes[d]),0)/ordinary.length:0;
  let comparison='本周期还没有带收入记录的特别日期';
  if(special.length&&!ordinary.length)comparison=`${comparisonCategory} ${special.length} 天；本周期没有普通营业日可比较`;
  if(special.length&&ordinary.length){const pct=ordinaryAvg?Math.round((specialAvg/ordinaryAvg-1)*100):null;comparison=`${comparisonCategory} ${special.length} 天，日均 ${money(specialAvg)}；普通营业日 ${ordinary.length} 天，日均 ${money(ordinaryAvg)}${pct===null?'':`；高低差 ${pct>=0?'+':''}${pct}%`}`;}
  $('#analysisCards').innerHTML=`<div class="analysis-card"><span>有收入记录的日均</span><b>${money(avg)}</b><small>共 ${activeCount} 天</small></div><div class="analysis-card"><span>本周期最高收入日</span><b>${best?money(best.income):'—'}</b><small>${best?safe(best.date):'记录后显示'}</small></div><div class="analysis-card"><span>主要收款渠道</span><b>${totals.income?`${top[0]} · ${share}%`:'—'}</b><small>${totals.income?`${money(top[1])} / 总收入 ${money(totals.income)}`:'记录收入后显示'}</small></div><div class="analysis-card special-comparison"><span>特别日期与普通营业日</span>${specialCategories.length?`<select id="compareSpecialCategory" aria-label="选择特别日期类型">${specialCategories.map(category=>`<option value="${safe(category)}" ${category===comparisonCategory?'selected':''}>${safe(category)}</option>`).join('')}</select>`:''}<b>${special.length?money(specialAvg):'待积累'}</b><small>${safe(comparison)}</small></div>`;
  $('#compareSpecialCategory')?.addEventListener('change',e=>{comparisonCategory=e.target.value;renderReports();});
  const start=parseDate(startKey),end=parseDate(endKey),previousEnd=new Date(start);previousEnd.setDate(start.getDate()-1);
  let previousStart=new Date(previousEnd);
  if(activePeriod==='week')previousStart.setDate(previousEnd.getDate()-6);
  if(activePeriod==='month')previousStart=new Date(previousEnd.getFullYear(),previousEnd.getMonth(),1);
  if(activePeriod==='year')previousStart=new Date(previousEnd.getFullYear(),0,1);
  let previousIncome=0,previousExpense=0,previousDays=0;
  for(let d=new Date(previousStart);d<=previousEnd;d.setDate(d.getDate()+1)){const key=dateString(d),t=dailyTotals(key);previousIncome+=t.income;previousExpense+=t.expense;if(db.incomes[key])previousDays++;}
  const previousNet=previousIncome-previousExpense,periodName={day:'昨日',week:'上周',month:'上月',year:'去年'}[activePeriod];
  const change=(current,previous)=>previous?`${current-previous>=0?'+':''}${Math.round((current/previous-1)*100)}%`:'暂无可比数据';
  $('#periodInsights').innerHTML=`<div class="analysis-card"><span>${activePeriod==='day'?'当日':activePeriod==='week'?'本周':activePeriod==='month'?'本月':'本年'}营收</span><b>${money(totals.income)}</b><small>${periodName} ${money(previousIncome)} · ${change(totals.income,previousIncome)}</small></div><div class="analysis-card"><span>经营结余</span><b>${money(totals.net)}</b><small>${periodName} ${money(previousNet)} · ${change(totals.net,previousNet)}</small></div><div class="analysis-card"><span>营业天数</span><b>${activeCount} 天</b><small>${periodName} ${previousDays} 天</small></div><div class="analysis-card"><span>支出占营收</span><b>${totals.income?Math.round(totals.expense/totals.income*100)+'%':'—'}</b><small>本期支出 ${money(totals.expense)} · ${periodName} ${money(previousExpense)}</small></div>`;
  const categories=new Map();
  for(const p of db.purchases.filter(p=>p.date>=startKey&&p.date<=endKey)){categories.set('原料采购',(categories.get('原料采购')||0)+num(p.qty)*num(p.unitCost));categories.set('采购附加费用',(categories.get('采购附加费用')||0)+num(p.extraCost));}
  for(const e of db.expenses.filter(e=>e.date>=startKey&&e.date<=endKey))categories.set(e.category,(categories.get(e.category)||0)+num(e.amount));
  const sorted=[...categories].filter(([,amount])=>amount>0).sort((a,b)=>b[1]-a[1]);
  $('#expenseCategoryList').innerHTML=sorted.length?sorted.map(([category,amount])=>`<div class="stock-row"><span class="row-title">${safe(category)}</span><strong>${money(amount)}</strong></div>`).join(''):'<div class="empty-state">本周期没有支出记录</div>';
}
$$('.period-button').forEach(b=>b.addEventListener('click',()=>{activePeriod=b.dataset.period;renderReports();$$('.period-button').forEach(x=>x.classList.toggle('active',x===b));}));
function shiftPeriod(direction){const d=parseDate(selectedDate);if(activePeriod==='day')d.setDate(d.getDate()+direction);else if(activePeriod==='week')d.setDate(d.getDate()+7*direction);else if(activePeriod==='month')d.setMonth(d.getMonth()+direction,1);else d.setFullYear(d.getFullYear()+direction);selectedDate=dateString(d);renderReports();}
$('#calendarPrev').addEventListener('click',()=>shiftPeriod(-1));$('#calendarNext').addEventListener('click',()=>shiftPeriod(1));
$('#calendarTitle').addEventListener('click',()=>{$('#reportDateForm [name=date]').value=selectedDate;$('#reportDateDialog').showModal();});
$('.close-report-date').addEventListener('click',()=>$('#reportDateDialog').close());
$('#reportDateForm').addEventListener('submit',e=>{e.preventDefault();selectedDate=e.currentTarget.elements.date.value;renderReports();$('#reportDateDialog').close();});

function csvCell(v){return '"'+String(v??'').replace(/"/g,'""')+'"';}
function downloadCSV(filename,rows){
  const content='\ufeff'+rows.map(row=>row.map(csvCell).join(',')).join('\r\n'); const blob=new Blob([content],{type:'text/csv;charset=utf-8'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=filename; a.click(); setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}
$('#exportDaily').addEventListener('click',()=>{
  const dates=new Set([...Object.keys(db.incomes),...db.purchases.map(p=>p.date),...db.expenses.map(e=>e.date),...Object.keys(db.specialDays)]); const sorted=[...dates].sort();
  const rows=[['日期','现金收入','微信收入','支付宝收入','总收入','采购支出','其他支出','经营结余','日期类型','日期事件','备注']];
  sorted.forEach(d=>{const i=db.incomes[d]||{}, t=dailyTotals(d),event=db.specialDays[d]||{};rows.push([d,num(i.cash).toFixed(2),num(i.wechat).toFixed(2),num(i.alipay).toFixed(2),t.income.toFixed(2),t.purchases.toFixed(2),t.other.toFixed(2),t.net.toFixed(2),event.category||'',event.title||'',event.note||i.note||'']);});
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
    db=normalizeDB(candidate);saveDB();toast('账本已从备份恢复');
  }catch(err){toast(err.message||'导入失败，请选择正确的备份文件');}
  finally{e.target.value='';}
});

seedDefaultIngredients();
setTodayInputs();
$('#incomeForm [name=date]').value=today();
render();
if('serviceWorker' in navigator&&location.protocol==='https:')navigator.serviceWorker.register('./sw.js').catch(()=>{});

