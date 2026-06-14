import { APP_CONFIG } from './firebase-config.js';
import { auth, db, storage, hasConfig } from './firebase-core.js';
import { onAuthStateChanged, signOut, sendPasswordResetEmail, sendEmailVerification, updateProfile } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js';
import { doc, getDoc, collection, addDoc, getDocs, updateDoc, deleteDoc, serverTimestamp, query, orderBy, limit, where } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js';
import { sendEmail, statementEmailPayload } from './email-service.js';
import { startSessionSecurity } from './security-service.js';

const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
let currentUser, userData = {}, edit = { type: null, id: null }, page = 1, charts = {}, txCacheTime = 0;
let cache = { income: [], expenses: [], budgets: [], goals: [], recurring: [], notifications: [], statements: [] };

const incomeCats = ['Salary','Freelancing','Business','Investments','Rental Income','Bonus','Other'];
const expenseCats = ['Food','Transport','Shopping','Bills','Entertainment','Health','Education','Travel','EMI','Insurance','Subscriptions','Other'];

const money = n => '₹' + Number(n || 0).toLocaleString(APP_CONFIG.locale || 'en-IN');
const uid = () => currentUser?.uid;
const today = () => new Date().toISOString().slice(0,10);
const monthKey = d => (d ? new Date(d) : new Date()).toISOString().slice(0,7);
const nowMonth = () => monthKey(new Date());
const sum = a => a.reduce((x,y) => x + Number(y.amount || 0), 0);
const byCat = arr => arr.reduce((o,x) => (o[x.category] = (o[x.category] || 0) + Number(x.amount || 0), o), {});

function toast(t, bad=false){
  const el = $('#toast');
  if(!el) return;
  el.textContent = t;
  el.className = 'toast show' + (bad ? ' error' : '');
  setTimeout(()=>el.classList.remove('show','error'),3000);
}

function skeleton(id){
  const el = $(id);
  if(el) el.innerHTML = '<div class="skeleton"></div><div class="skeleton short"></div>';
}

function safeText(v){
  return String(v ?? '').replace(/[<>&]/g, s => ({'<':'&lt;','>':'&gt;','&':'&amp;'}[s]));
}

async function audit(action, meta={}){
  try{
    await addDoc(collection(db,'auditLogs'), {
      userId: uid(),
      uid: uid(),
      email: currentUser?.email || null,
      action,
      ipAddress: 'client-unavailable',
      userAgent: navigator.userAgent,
      meta,
      timestamp: serverTimestamp(),
      createdAt: serverTimestamp()
    });
  }catch(_){}
}

async function notify(type, title, body){
  try{
    await addDoc(collection(db,'users',uid(),'notifications'), {
      type,
      title,
      body,
      read:false,
      createdAt:serverTimestamp()
    });
  }catch(_){}
}

function healthScore(){
  const inc = sum(cache.income);
  const exp = sum(cache.expenses);
  const sav = Math.max(0, inc - exp);
  const monthlyIncome = sum(cache.income.filter(x=>monthKey(x.date)===nowMonth()));
  const monthlyExpense = sum(cache.expenses.filter(x=>monthKey(x.date)===nowMonth()));
  const monthlyBudget = Number(cache.budgets.find(b=>b.category==='Monthly')?.amount) || monthlyIncome || 1;
  const savingsRate = inc ? Math.min(35, sav / inc * 35) : 0;
  const budgetCompliance = cache.budgets.length ? Math.max(0, 25 - (monthlyExpense / monthlyBudget) * 10) : 8;
  const expenseControl = inc ? Math.max(0, 25 - (exp / inc) * 15) : 5;
  const goalProgress = cache.goals.length ? Math.min(15, cache.goals.reduce((a,g)=>a + (Number(g.current || 0) / Number(g.target || 1)) * 15 / cache.goals.length, 0)) : 4;
  return Math.round(Math.min(100, savingsRate + budgetCompliance + expenseControl + goalProgress));
}

function healthLabel(s){
  return s >= 80 ? 'Excellent' : s >= 65 ? 'Good' : s >= 45 ? 'Average' : 'Needs Improvement';
}

function totals(){
  const inc = sum(cache.income);
  const exp = sum(cache.expenses);
  const mi = sum(cache.income.filter(x=>monthKey(x.date)===nowMonth()));
  const me = sum(cache.expenses.filter(x=>monthKey(x.date)===nowMonth()));
  const sav = inc - exp;
  return { inc, exp, sav, bal:sav, mi, me, ms:mi-me, score:healthScore() };
}

async function loadCol(name){
  const refc = collection(db,'users',uid(),name);
  let snap;
  try{
    snap = await getDocs(query(refc,orderBy('date','desc'),limit(200)));
  }catch{
    snap = await getDocs(refc);
  }
  cache[name] = snap.docs.map(d=>({id:d.id,...d.data()}));
}

async function loadAll(force=false){
  if(!force && Date.now() - txCacheTime < APP_CONFIG.cacheTtlMs) return renderAll();
  txCacheTime = Date.now();
  ['#summaryCards','#incomeTable','#expenseTable','#txTable'].forEach(skeleton);
  await Promise.all(['income','expenses','budgets','goals','recurring','notifications','statements'].map(loadCol));
  await generateDueRecurring();
  renderAll();
}

function renderCards(){
  const t = totals();
  $('#summaryCards').innerHTML = [
    ['Total Income',money(t.inc)],
    ['Total Expenses',money(t.exp)],
    ['Total Savings',money(t.sav)],
    ['Current Balance',money(t.bal)],
    ['Monthly Income',money(t.mi)],
    ['Monthly Expenses',money(t.me)],
    ['Financial Health Score',t.score+'/100']
  ].map(([a,b])=>`<div class="card glass"><h3>${a}</h3><div class="value">${b}</div><span class="badge active">${a.includes('Score')?healthLabel(t.score):'Live'}</span></div>`).join('');
}

function renderQuick(){
  $('#quickActions').innerHTML = [
    ['Add Income','income'],
    ['Add Expense','expense'],
    ['Create Goal','goal'],
    ['Set Budget','budget'],
    ['Generate Report','reports'],
    ['Download Statement','statementCenter']
  ].map(a=>`<button class="quick" data-quick="${a[1]}"><b>${a[0]}</b><br><span class="muted">Quick action</span></button>`).join('');

  $$('[data-quick]').forEach(b=>{
    b.onclick = () => b.dataset.quick === 'reports'
      ? showPage('reports')
      : b.dataset.quick === 'statementCenter'
        ? showPage('statements')
        : openModal(b.dataset.quick);
  });
}

function rowBtns(type,id){
  return `<button class="btn" onclick="window.finoraEdit('${type}','${id}')">Edit</button> <button class="btn danger" onclick="window.finoraDelete('${type}','${id}')">Delete</button>`;
}

function renderTable(id,arr,type){
  $(id).innerHTML = `<thead><tr><th>Date</th><th>Category</th><th>Description</th><th>Amount</th><th>Actions</th></tr></thead><tbody>${arr.map(x=>`<tr><td>${safeText(x.date)}</td><td>${safeText(x.category)}</td><td>${safeText(x.description)}</td><td>${money(x.amount)}</td><td>${rowBtns(type,x.id)}</td></tr>`).join('') || '<tr><td colspan="5"><div class="empty">No records found</div></td></tr>'}</tbody>`;
}

function renderIncomeExpense(){
  const is = $('#incomeSearch')?.value?.toLowerCase() || '';
  const ifc = $('#incomeFilter')?.value || '';
  const es = $('#expenseSearch')?.value?.toLowerCase() || '';
  const efc = $('#expenseFilter')?.value || '';

  renderTable('#incomeTable', cache.income.filter(x=>(!ifc || x.category===ifc) && JSON.stringify(x).toLowerCase().includes(is)), 'income');
  renderTable('#expenseTable', cache.expenses.filter(x=>(!efc || x.category===efc) && JSON.stringify(x).toLowerCase().includes(es)), 'expenses');
}

function renderBudgets(){
  const expCat = byCat(cache.expenses);
  $('#budgetList').innerHTML = '<h2>Budget Planner</h2>' + (
    cache.budgets.map(b=>{
      const spent = b.category === 'Monthly' ? totals().me : (expCat[b.category] || 0);
      const pct = Math.min(100, spent / Number(b.amount || 1) * 100);
      return `<div class="insight"><b>${safeText(b.category)} Budget</b><p>${money(spent)} used of ${money(b.amount)} • Remaining ${money(Number(b.amount || 0) - spent)}</p><div class="progress"><div class="bar ${pct>90?'danger':''}" style="width:${pct}%"></div></div><span class="badge ${pct>90?'danger':'active'}">${Math.round(pct)}%</span></div>`;
    }).join('') || '<div class="empty">No budgets yet. Set your first budget.</div>'
  );
}

function renderGoals(){
  $('#goalList').innerHTML = cache.goals.map(g=>{
    const pct = Math.min(100, Number(g.current || 0) / Number(g.target || 1) * 100);
    return `<div class="card glass"><h3>${safeText(g.name)}</h3><p>${money(g.current)} / ${money(g.target)}</p><div class="progress"><div class="bar" style="width:${pct}%"></div></div><p class="muted">Deadline: ${safeText(g.deadline)} • ${Math.round(pct)}%</p>${pct>=100?'<span class="badge active">Completed</span>':''}${rowBtns('goals',g.id)}</div>`;
  }).join('') || '<div class="card glass empty">No goals yet.</div>';
}

function renderRecurring(){
  $('#recurringTable').innerHTML = `<thead><tr><th>Type</th><th>Frequency</th><th>Category</th><th>Amount</th><th>Last Generated</th><th>Actions</th></tr></thead><tbody>${cache.recurring.map(r=>`<tr><td>${r.txType}</td><td>${r.frequency}</td><td>${r.category}</td><td>${money(r.amount)}</td><td>${r.lastGeneratedDate || 'Never'}</td><td>${rowBtns('recurring',r.id)}</td></tr>`).join('') || '<tr><td colspan="6">No recurring rules</td></tr>'}</tbody>`;
}

function insights(){
  const exp = byCat(cache.expenses);
  const top = Object.entries(exp).sort((a,b)=>b[1]-a[1])[0];
  const t = totals();
  $('#insights').innerHTML = [
    `Highest spending category: <b>${top ? top[0] : 'None'}</b>.`,
    `Savings performance: <b>${healthLabel(t.score)}</b>.`,
    `Recommendation: ${t.me > t.mi ? 'Reduce discretionary spending this month.' : 'Keep your spending below income and increase goal contributions.'}`
  ].map(x=>`<div class="insight">${x}</div>`).join('');
}

function recent(){
  const rows = [...cache.income.map(x=>({Type:'Income',...x})), ...cache.expenses.map(x=>({Type:'Expense',...x}))]
    .sort((a,b)=>new Date(b.date)-new Date(a.date))
    .slice(0,6);
  $('#recentTable').innerHTML = `<tbody>${rows.map(r=>`<tr><td>${r.date}</td><td>${r.Type}</td><td>${r.category}</td><td>${money(r.amount)}</td></tr>`).join('') || '<tr><td>No recent transactions</td></tr>'}</tbody>`;
}

function renderTransactions(){
  let rows = [...cache.income.map(x=>({Type:'Income',...x})), ...cache.expenses.map(x=>({Type:'Expense',...x}))];
  const search = $('#txSearch')?.value?.toLowerCase() || '';
  const sort = $('#txSort')?.value || 'dateDesc';

  rows = rows.filter(r=>JSON.stringify(r).toLowerCase().includes(search));
  rows.sort((a,b)=>sort==='dateAsc' ? new Date(a.date)-new Date(b.date) : sort==='amountDesc' ? b.amount-a.amount : sort==='amountAsc' ? a.amount-b.amount : new Date(b.date)-new Date(a.date));

  const size = APP_CONFIG.pageSize;
  const total = Math.max(1,Math.ceil(rows.length/size));
  page = Math.min(page,total);
  const view = rows.slice((page-1)*size,page*size);

  $('#txTable').innerHTML = `<thead><tr><th>Date</th><th>Type</th><th>Category</th><th>Description</th><th>Amount</th></tr></thead><tbody>${view.map(r=>`<tr><td>${r.date}</td><td>${r.Type}</td><td>${r.category}</td><td>${safeText(r.description)}</td><td>${money(r.amount)}</td></tr>`).join('') || '<tr><td colspan="5">No transactions</td></tr>'}</tbody>`;
  $('#pageInfo').textContent = `Page ${page} of ${total}`;
}

function renderNotifications(){
  $('#notificationList').innerHTML = cache.notifications.map(n=>`<div class="insight"><b>${safeText(n.title)}</b><p>${safeText(n.body)}</p></div>`).join('') || '<div class="empty">No notifications yet.</div>';
}

function budgetStatus(){
  const t = totals();
  const monthly = Number(cache.budgets.find(b=>b.category==='Monthly')?.amount || t.mi || 1);
  const pct = Math.min(100,t.me/monthly*100);
  $('#budgetStatus').innerHTML = `<div class="insight"><b>Monthly Budget</b><p>${money(t.me)} spent of ${money(monthly)}</p><div class="progress"><div class="bar ${pct>90?'danger':''}" style="width:${pct}%"></div></div></div>`;
}

function chart(id,type,labels,data,label='Amount'){
  const canvas = $('#'+id);
  if(!canvas || !window.Chart) return;
  charts[id]?.destroy();
  charts[id] = new Chart(canvas,{
    type,
    data:{ labels, datasets:[{ label, data, borderWidth:2, tension:.35 }] },
    options:{
      responsive:true,
      plugins:{ legend:{ labels:{ color:getComputedStyle(document.body).getPropertyValue('--text') } } },
      scales:type==='pie'||type==='doughnut'?{}:{
        x:{ ticks:{ color:getComputedStyle(document.body).getPropertyValue('--muted') } },
        y:{ ticks:{ color:getComputedStyle(document.body).getPropertyValue('--muted') } }
      }
    }
  });
}

function renderCharts(){
  const exp = byCat(cache.expenses);
  const inc = byCat(cache.income);
  const t = totals();
  const months = [...new Set([...cache.income,...cache.expenses].map(x=>monthKey(x.date)))].sort().slice(-12);
  const mi = months.map(m=>sum(cache.income.filter(x=>monthKey(x.date)===m)));
  const me = months.map(m=>sum(cache.expenses.filter(x=>monthKey(x.date)===m)));

  chart('expensePie','pie',Object.keys(exp),Object.values(exp));
  chart('incomePie','pie',Object.keys(inc),Object.values(inc));
  chart('savingsDonut','doughnut',['Savings','Expenses'],[Math.max(0,t.sav),t.exp]);
  chart('budgetChart','doughnut',['Used','Remaining'],[t.me,Math.max(0,(cache.budgets[0]?.amount||t.mi)-t.me)]);
  chart('overviewBar','bar',months,mi.map((v,i)=>v-me[i]),'Net Savings');
  chart('monthlySavings','bar',months,mi.map((v,i)=>v-me[i]));
  chart('incomeTrend','line',months,mi);
  chart('expenseTrend','line',months,me);
}

function renderAll(){
  renderCards();
  renderQuick();
  renderIncomeExpense();
  renderBudgets();
  renderGoals();
  renderRecurring();
  insights();
  recent();
  renderTransactions();
  renderNotifications();
  renderStatementHistory();
  budgetStatus();
  renderCharts();

  $('#profileName').value = userData.name || '';
  $('#profileEmail').value = userData.email || '';

  const prev = $('#profilePreview');
  if(prev && userData.photoURL){
    prev.src = userData.photoURL;
    prev.hidden = false;
  }

  $('#adminLink').hidden = !['admin','super_admin'].includes(userData.role);

  const sf = $('#statementFrom'), st = $('#statementTo');
  if(sf && !sf.value){
    const d = new Date();
    sf.value = new Date(d.getFullYear(),d.getMonth(),1).toISOString().slice(0,10);
  }
  if(st && !st.value) st.value = today();
}

function showPage(id){
  $$('.section').forEach(s=>s.classList.toggle('active',s.id===id));
  $$('.nav-link').forEach(n=>n.classList.toggle('active',n.dataset.page===id));
  $('#pageTitle').textContent = $(`[data-page="${id}"]`)?.textContent || id;
  if(innerWidth < 760) $('#sidebar').classList.remove('open');
}

function fields(type,data={}){
  const cats = type === 'income' ? incomeCats : expenseCats;

  if(type === 'goal'){
    return `<label>Name<input name="name" required value="${safeText(data.name)}"></label><label>Target Amount<input name="target" type="number" required value="${data.target||''}"></label><label>Current Progress<input name="current" type="number" value="${data.current||0}"></label><label>Deadline<input name="deadline" type="date" required value="${data.deadline||''}"></label>`;
  }

  if(type === 'budget'){
    return `<label>Category<select name="category"><option>Monthly</option>${expenseCats.map(c=>`<option ${data.category===c?'selected':''}>${c}</option>`).join('')}</select></label><label>Budget Amount<input name="amount" type="number" required value="${data.amount||''}"></label><input type="hidden" name="date" value="${today()}"><input type="hidden" name="description" value="Budget">`;
  }

  if(type === 'recurring'){
    return `<label>Type<select name="txType"><option ${data.txType==='income'?'selected':''}>income</option><option ${data.txType==='expenses'?'selected':''}>expenses</option></select></label><label>Amount<input name="amount" type="number" required value="${data.amount||''}"></label><label>Category<select name="category">${[...incomeCats,...expenseCats].map(c=>`<option ${data.category===c?'selected':''}>${c}</option>`).join('')}</select></label><label>Frequency<select name="frequency">${['Daily','Weekly','Monthly','Yearly'].map(f=>`<option ${data.frequency===f?'selected':''}>${f}</option>`).join('')}</select></label><label>Start Date<input type="date" name="date" value="${data.date||today()}"></label><label class="full">Description<textarea name="description">${safeText(data.description)}</textarea></label>`;
  }

  return `<label>Amount<input name="amount" type="number" required value="${data.amount||''}"></label><label>Category<select name="category">${cats.map(c=>`<option ${data.category===c?'selected':''}>${c}</option>`).join('')}</select></label><label>Date<input name="date" type="date" required value="${data.date||today()}"></label><label class="full">Description<textarea name="description">${safeText(data.description)}</textarea></label>`;
}

function openModal(type,data={}){
  edit = { type, id:data.id || null };
  $('#modalTitle').textContent = (data.id ? 'Edit ' : 'Add ') + type;
  $('#dataForm').innerHTML = fields(type,data) + `<div class="full toolbar"><button class="btn primary">Save</button><button type="button" class="btn ghost" id="closeModal">Cancel</button></div>`;
  $('#modal').classList.add('show');
  $('#closeModal').onclick = () => $('#modal').classList.remove('show');
}

async function saveForm(e){
  e.preventDefault();
  const o = Object.fromEntries(new FormData(e.target).entries());
  let col = edit.type === 'expense' ? 'expenses' : edit.type;

  if(edit.type === 'goal') col = 'goals';
  if(edit.type === 'budget') col = 'budgets';
  if(edit.type === 'recurring') col = 'recurring';

  ['amount','target','current'].forEach(k=>{
    if(o[k] !== undefined) o[k] = Number(o[k] || 0);
  });

  try{
    if(edit.id) await updateDoc(doc(db,'users',uid(),col,edit.id),{...o,updatedAt:serverTimestamp()});
    else await addDoc(collection(db,'users',uid(),col),{...o,createdAt:serverTimestamp()});
    await audit(edit.id ? 'Data Update' : 'Data Creation',{collection:col});
    $('#modal').classList.remove('show');
    txCacheTime = 0;
    await loadAll(true);
    toast('Saved successfully');
  }catch(err){
    toast(err.message,true);
  }
}

window.finoraEdit = (type,id) => {
  const col = type === 'expenses' ? 'expenses' : type;
  openModal(type === 'expenses' ? 'expense' : type, cache[col].find(x=>x.id===id));
};

window.finoraDelete = async(type,id) => {
  const col = type === 'expenses' ? 'expenses' : type;
  if(confirm('Delete this record?')){
    await deleteDoc(doc(db,'users',uid(),col,id));
    await audit('Data Deletion',{collection:col,id});
    txCacheTime = 0;
    await loadAll(true);
    toast('Deleted');
  }
};

function dueDates(last, frequency, start){
  const out = [];
  let d = new Date(last || start || today());
  const end = new Date(today());

  if(!last) d = new Date(start || today());
  else{
    if(frequency === 'Daily') d.setDate(d.getDate()+1);
    if(frequency === 'Weekly') d.setDate(d.getDate()+7);
    if(frequency === 'Monthly') d.setMonth(d.getMonth()+1);
    if(frequency === 'Yearly') d.setFullYear(d.getFullYear()+1);
  }

  while(d <= end){
    out.push(d.toISOString().slice(0,10));
    if(frequency === 'Daily') d.setDate(d.getDate()+1);
    else if(frequency === 'Weekly') d.setDate(d.getDate()+7);
    else if(frequency === 'Monthly') d.setMonth(d.getMonth()+1);
    else d.setFullYear(d.getFullYear()+1);
    if(out.length > 36) break;
  }

  return out;
}

async function generateDueRecurring(manual=false){
  let created = 0;

  for(const r of cache.recurring){
    const dates = dueDates(r.lastGeneratedDate,r.frequency,r.date);
    for(const dt of dates){
      const fingerprint = `${r.id}_${dt}`;
      const existing = await getDocs(query(collection(db,'users',uid(),r.txType || 'expenses'),where('recurringFingerprint','==',fingerprint),limit(1)));

      if(existing.empty){
        await addDoc(collection(db,'users',uid(),r.txType || 'expenses'),{
          amount:Number(r.amount),
          category:r.category,
          date:dt,
          description:r.description || 'Recurring transaction',
          recurringId:r.id,
          recurringFingerprint:fingerprint,
          createdAt:serverTimestamp()
        });
        created++;
      }

      await updateDoc(doc(db,'users',uid(),'recurring',r.id),{lastGeneratedDate:dt,updatedAt:serverTimestamp()});
      r.lastGeneratedDate = dt;
    }
  }

  if(created){
    await audit('Recurring Transactions Generated',{created});
    if(manual) toast(`${created} due transactions created`);
    await Promise.all(['income','expenses','recurring'].map(loadCol));
  }else if(manual) toast('No due recurring transactions');
}

function exportRows(){
  return [
    ...cache.income.map(x=>({Type:'Income',Date:x.date,Category:x.category,Description:x.description,Amount:x.amount})),
    ...cache.expenses.map(x=>({Type:'Expense',Date:x.date,Category:x.category,Description:x.description,Amount:x.amount}))
  ];
}

function download(blob,name){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

function csv(){
  const rows = exportRows(), keys = ['Type','Date','Category','Description','Amount'];
  const text = [keys.join(','),...rows.map(r=>keys.map(k=>`"${String(r[k]??'').replaceAll('"','""')}"`).join(','))].join('\n');
  download(new Blob([text],{type:'text/csv'}),'FINORA_Transactions.csv');
  audit('Export CSV');
}

function excel(){
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(exportRows()),'Transactions');
  XLSX.writeFile(wb,'FINORA_Transactions.xlsx');
  audit('Export Excel');
}

function pdf(){
  const {jsPDF} = window.jspdf;
  const doc = new jsPDF();
  doc.text('FINORA Transaction Report',14,18);
  exportRows().slice(0,40).forEach((r,i)=>doc.text(`${r.Date} | ${r.Type} | ${r.Category} | ${money(r.Amount)}`,14,30+i*6));
  doc.save('FINORA_Transactions.pdf');
  audit('Export PDF');
}

function dateInRange(row, from, to){
  const d = row?.date || '';
  return d >= from && d <= to;
}

function statementFileName(from,to){
  return `Statement_${from.replaceAll('-','_')}_to_${to.replaceAll('-','_')}.pdf`;
}

function getStatementRange(){
  const from = $('#statementFrom')?.value;
  const to = $('#statementTo')?.value;
  if(!from || !to) throw new Error('Please select From Date and To Date.');
  if(from > to) throw new Error('From Date cannot be after To Date.');
  return { from, to };
}

function categoryRows(map){
  return Object.entries(map || {}).sort((a,b)=>Number(b[1] || 0)-Number(a[1] || 0));
}

function rangeMonths(from,to){
  const out = [];
  const d = new Date(from + 'T00:00:00');
  const end = new Date(to + 'T00:00:00');
  d.setDate(1);

  while(d <= end){
    out.push(d.toISOString().slice(0,7));
    d.setMonth(d.getMonth()+1);
    if(out.length > 36) break;
  }

  return out;
}

function formatStatementDate(value){
  if(!value) return '-';
  const date = value instanceof Date ? value : new Date(String(value).includes('T') ? value : `${value}T00:00:00`);
  if(Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}).replace(/ /g,'-');
}

function formatPdfCurrency(value){
  const amount = Number(value || 0);
  const abs = Math.abs(amount);
  const formatted = abs.toLocaleString('en-IN',{maximumFractionDigits:2});
  return `${amount < 0 ? '-' : ''}INR ${formatted}`;
}

function cleanPdfText(value){
  return String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g,' ')
    .replace(/[✓✔☑]/g,'•')
    .replace(/[₹]/g,'INR ')
    .replace(/[¹]/g,'')
    .replace(/\s+/g,' ')
    .trim();
}

function savingsRatePercent(data){
  return data.totalIncome ? ((data.totalIncome - data.totalExpenses) / data.totalIncome) * 100 : 0;
}

function budgetUtilizationFor(expenses){
  const monthlyBudget = Number(cache.budgets.find(b=>b.category === 'Monthly')?.amount || 0);
  const categoryBudgetTotal = cache.budgets
    .filter(b=>b.category !== 'Monthly')
    .reduce((total,b)=>total + Number(b.amount || 0),0);
  const budgetBase = monthlyBudget || categoryBudgetTotal || sum(expenses) || 1;
  return Math.min(100, Math.round(sum(expenses) / budgetBase * 100));
}

function statementHealth(data){
  const savingRate = data.totalIncome ? (data.totalSavings / data.totalIncome) * 100 : 0;
  const budgetScore = Math.max(0,100-data.budgetUtilization);
  const savingScore = Math.max(0,Math.min(100,savingRate*2));
  const expenseScore = data.totalIncome ? Math.max(0,100-(data.totalExpenses/data.totalIncome*100)) : 50;
  const goalPct = cache.goals.length
    ? cache.goals.reduce((a,g)=>a+Math.min(100,Number(g.current||0)/Number(g.target||1)*100),0)/cache.goals.length
    : 70;
  return Math.round((savingScore*.35)+(budgetScore*.25)+(expenseScore*.25)+(goalPct*.15));
}

function transactionDescription(row,type){
  const category = cleanPdfText(row.category || (type === 'income' ? 'Income' : 'Expense'));
  const description = cleanPdfText(row.description || row.notes || '');
  return description ? `${category} - ${description}` : category;
}

function buildMainStatementRows(data){
  let runningTotal = Number(data.openingBalance || 0);
  const rows = [];

  if(runningTotal !== 0){
    rows.push({
      date:data.from,
      description:'Opening Balance',
      income: runningTotal > 0 ? runningTotal : null,
      expense: runningTotal < 0 ? Math.abs(runningTotal) : null,
      runningTotal
    });
  }

  const transactions = [
    ...data.income.map(x=>({
      type:'income',
      date:x.date,
      description:transactionDescription(x,'income'),
      amount:Number(x.amount || 0),
      id:x.id || ''
    })),
    ...data.expenses.map(x=>({
      type:'expense',
      date:x.date,
      description:transactionDescription(x,'expense'),
      amount:Number(x.amount || 0),
      id:x.id || ''
    }))
  ].sort((a,b)=>{
    const dateSort = String(a.date || '').localeCompare(String(b.date || ''));
    if(dateSort) return dateSort;
    if(a.type !== b.type) return a.type === 'income' ? -1 : 1;
    return String(a.id).localeCompare(String(b.id));
  });

  transactions.forEach(tx=>{
    runningTotal += tx.type === 'income' ? tx.amount : -tx.amount;

    rows.push({
      date:tx.date,
      description:tx.description,
      income:tx.type === 'income' ? tx.amount : null,
      expense:tx.type === 'expense' ? tx.amount : null,
      runningTotal
    });
  });

  return rows;
}

function buildSpendingRows(data){
  return categoryRows(data.expenseCats).map(([category,amount])=>({
    category,
    amount,
    percentage:data.totalExpenses ? (Number(amount || 0) / data.totalExpenses) * 100 : 0
  }));
}

function buildBudgetRows(data){
  const spentByCategory = byCat(data.expenses);
  return (data.budgets || [])
    .map(b=>{
      const category = b.category || 'Monthly';
      const budget = Number(b.amount || 0);
      const spent = category === 'Monthly' ? data.totalExpenses : Number(spentByCategory[category] || 0);
      const remaining = budget - spent;
      return { category, budget, spent, remaining };
    })
    .filter(row=>row.category && !(row.budget === 0 && row.spent === 0 && row.remaining === 0));
}

function buildGoalRows(data){
  return (data.goals || [])
    .filter(g=>g.name || Number(g.target || 0) || Number(g.current || 0))
    .map(g=>{
      const target = Number(g.target || 0);
      const current = Number(g.current || 0);
      const progress = target ? Math.min(100,Math.round((current/target)*100)) : 0;
      return {
        name:g.name || 'Untitled Goal',
        target,
        current,
        progress
      };
    });
}

function buildStatementData(from,to){
  const income = cache.income
    .filter(r=>dateInRange(r,from,to))
    .sort((a,b)=>String(a.date).localeCompare(String(b.date)));

  const expenses = cache.expenses
    .filter(r=>dateInRange(r,from,to))
    .sort((a,b)=>String(a.date).localeCompare(String(b.date)));

  const totalIncome = sum(income);
  const totalExpenses = sum(expenses);
  const totalSavings = totalIncome - totalExpenses;
  const openingBalance = sum(cache.income.filter(r=>(r.date || '') < from)) - sum(cache.expenses.filter(r=>(r.date || '') < from));

  const data = {
    from,
    to,
    income,
    expenses,
    budgets:cache.budgets,
    goals:cache.goals,
    totalIncome,
    totalExpenses,
    totalSavings,
    openingBalance,
    currentBalance:openingBalance + totalSavings,
    budgetUtilization:budgetUtilizationFor(expenses)
  };

  data.healthScore = statementHealth(data);
  data.expenseCats = byCat(expenses);
  data.incomeCats = byCat(income);
  data.months = rangeMonths(from,to);
  data.monthIncome = data.months.map(m=>sum(income.filter(x=>monthKey(x.date)===m)));
  data.monthExpense = data.months.map(m=>sum(expenses.filter(x=>monthKey(x.date)===m)));
  data.monthSavings = data.monthIncome.map((v,i)=>v-data.monthExpense[i]);
  data.statementRows = buildMainStatementRows(data);
  data.spendingRows = buildSpendingRows(data);
  data.budgetRows = buildBudgetRows(data);
  data.goalRows = buildGoalRows(data);
  data.insights = statementInsights(data);

  return data;
}

function statementInsights(data){
  const highestSpending = data.spendingRows?.[0];
  const largestExpense = [...data.expenses].sort((a,b)=>Number(b.amount||0)-Number(a.amount||0))[0];
  const savingsRate = Math.round(savingsRatePercent(data));
  const trend = data.monthSavings.length > 1 ? data.monthSavings.at(-1) - data.monthSavings.at(-2) : data.totalSavings;
  const health = healthLabel(data.healthScore);
  const insights = [];

  insights.push(`Savings Rate: You saved ${savingsRate}% of your income during this period.`);

  if(highestSpending){
    insights.push(`Highest Spending Category: The highest spending category was ${highestSpending.category}, accounting for ${highestSpending.percentage.toFixed(1)}% of total expenses.`);
  }

  if(largestExpense){
    insights.push(`Largest Expense: Your largest expense was ${largestExpense.category || 'Expense'} - ${largestExpense.description || 'No description'} at ${money(largestExpense.amount)}.`);
  }

  insights.push(`Budget Utilization: Budget utilization remained at ${data.budgetUtilization}%.`);
  insights.push(trend >= 0 ? 'Spending Pattern: Your savings pattern stayed positive for this period.' : 'Spending Pattern: Savings declined compared with the previous period.');
  insights.push(`Financial Health: Your financial health score is ${health}.`);
  insights.push(data.totalSavings > 0 ? 'Personalized Recommendation: Consider allocating part of your savings to emergency funds or long-term investments.' : 'Personalized Recommendation: Reducing discretionary spending by 10% can significantly improve savings.');

  return insights;
}

function setStatementStatus(text,bad=false){
  const el = $('#statementStatus');
  if(!el) return;
  el.textContent = text;
  el.className = 'message show' + (bad ? ' error' : '');
}

function renderStatementCharts(data){
  chart('statementExpensePie','pie',Object.keys(data.expenseCats),Object.values(data.expenseCats));
  chart('statementIncomePie','pie',Object.keys(data.incomeCats),Object.values(data.incomeCats));
  chart('statementIncomeExpenseBar','bar',['Income','Expenses'],[data.totalIncome,data.totalExpenses]);
  chart('statementSavingsTrend','line',data.months,data.monthSavings,'Savings');
}

function renderStatementPreview(data){
  const p = $('#statementPreview');
  if(!p) return;

  const hasTx = data.income.length || data.expenses.length;

  p.innerHTML = `
    <div class="statement-head">
      <div class="logo-mark">F</div>
      <div>
        <h3>FINORA Financial Statement</h3>
        <p class="muted">${safeText(formatStatementDate(data.from))} to ${safeText(formatStatementDate(data.to))}</p>
      </div>
    </div>
    <div class="cards grid statement-mini">
      <div class="card"><h3>Total Income</h3><div class="value">${money(data.totalIncome)}</div></div>
      <div class="card"><h3>Total Expenses</h3><div class="value">${money(data.totalExpenses)}</div></div>
      <div class="card"><h3>Total Savings</h3><div class="value">${money(data.totalSavings)}</div></div>
      <div class="card"><h3>Current Balance</h3><div class="value">${money(data.currentBalance)}</div></div>
      <div class="card"><h3>Savings Rate</h3><div class="value">${Math.round(savingsRatePercent(data))}%</div></div>
      <div class="card"><h3>Health Score</h3><div class="value">${data.healthScore}/100</div></div>
    </div>
    ${hasTx ? '' : '<div class="empty">No transactions found in this date range. Statement can still include budgets and goals.</div>'}
    <h3>AI Financial Insights</h3>
    ${data.insights.map(i=>`<div class="insight">${safeText(i)}</div>`).join('')}
  `;

  renderStatementCharts(data);
  $('#downloadStatement').disabled = false;
  $('#emailStatement').disabled = false;
  window.finoraLastStatementData = data;
}

function pdfW(doc){ return doc.internal.pageSize.getWidth(); }
function pdfH(doc){ return doc.internal.pageSize.getHeight(); }

function pdfHeader(doc,data){
  const w = pdfW(doc);
  doc.setFillColor(7,17,31);
  doc.rect(0,0,w,39,'F');

  doc.setTextColor(255,255,255);
  doc.setFont('helvetica','bold');
  doc.setFontSize(22);
  doc.text('FINORA',14,13);

  doc.setFont('helvetica','normal');
  doc.setFontSize(8.5);
  doc.text('AI Powered Personal Finance Management',14,21);

  doc.setFont('helvetica','bold');
  doc.setFontSize(13);
  doc.text('FINANCIAL STATEMENT',126,13);

  doc.setFont('helvetica','normal');
  doc.setFontSize(8.5);
  doc.text(`Generated Date: ${formatStatementDate(new Date())}`,126,21);
  doc.text(`Statement Period: ${formatStatementDate(data.from)} to ${formatStatementDate(data.to)}`,126,28);

  doc.setDrawColor(245,158,11);
  doc.setLineWidth(.7);
  doc.line(14,34,w-14,34);
}

function pdfFooter(doc){
  const pages = doc.internal.getNumberOfPages();
  const h = pdfH(doc);
  const w = pdfW(doc);

  for(let i=1;i<=pages;i++){
    doc.setPage(i);
    doc.setDrawColor(226,232,240);
    doc.line(14,h-13,w-14,h-13);

    doc.setTextColor(100,116,139);
    doc.setFont('helvetica','normal');
    doc.setFontSize(8);
    doc.text('Generated by FINORA AI',14,h-7);
    doc.text('Confidential Financial Statement',w/2,h-7,{align:'center'});
    doc.text(`Page ${i} of ${pages}`,w-14,h-7,{align:'right'});
  }
}

function newPdfPage(doc,data){
  doc.addPage();
  pdfHeader(doc,data);
  return 49;
}

function ensurePageSpace(doc,data,y,needed=14){
  return y + needed <= pdfH(doc) - 23 ? y : newPdfPage(doc,data);
}

function pdfSectionTitle(doc,data,title,y){
  y = ensurePageSpace(doc,data,y,14);
  doc.setTextColor(15,23,42);
  doc.setFont('helvetica','bold');
  doc.setFontSize(11);
  doc.text(cleanPdfText(title),14,y);
  doc.setDrawColor(226,232,240);
  doc.line(14,y+2,pdfW(doc)-14,y+2);
  return y + 9;
}

function pdfSummaryGrid(doc,data,items,y){
  const cardW = 56;
  const cardH = 18;
  const gap = 6;

  items.forEach((item,index)=>{
    y = ensurePageSpace(doc,data,y,cardH + 5);
    const col = index % 3;
    const rowBreak = col === 0 && index > 0;

    if(rowBreak) y += cardH + 4;

    const x = 14 + col * (cardW + gap);

    doc.setFillColor(248,250,252);
    doc.setDrawColor(226,232,240);
    doc.roundedRect(x,y-5,cardW,cardH,2,2,'FD');

    doc.setTextColor(100,116,139);
    doc.setFont('helvetica','normal');
    doc.setFontSize(7.5);
    doc.text(cleanPdfText(item.label),x+3,y);

    doc.setTextColor(15,23,42);
    doc.setFont('helvetica','bold');
    doc.setFontSize(10);
    doc.text(cleanPdfText(item.value),x+3,y+7);
  });

  return y + 24;
}

function pdfKeyValue(doc,data,items,y){
  doc.setFontSize(9);
  items.forEach((item,index)=>{
    const x = index % 2 ? 110 : 14;
    if(index % 2 === 0 && index > 0) y += 8;

    y = ensurePageSpace(doc,data,y,8);

    doc.setTextColor(51,65,85);
    doc.setFont('helvetica','bold');
    doc.text(`${cleanPdfText(item.label)}:`,x,y);

    doc.setFont('helvetica','normal');
    doc.text(cleanPdfText(item.value),x+42,y);
  });
  return y + 11;
}

function pdfWrappedLines(doc,text,width){
  return doc.splitTextToSize(cleanPdfText(text),width);
}

function drawTableHeader(doc,columns,y){
  doc.setFillColor(238,244,255);
  doc.setDrawColor(226,232,240);
  doc.rect(14,y-5,182,9,'FD');

  doc.setTextColor(15,23,42);
  doc.setFont('helvetica','bold');
  doc.setFontSize(8);

  let x = 17;
  columns.forEach(col=>{
    doc.text(cleanPdfText(col.label),x,y);
    x += col.width;
  });

  return y + 8;
}

function drawPdfTable(doc,data,title,rows,columns,y,emptyMessage){
  y = pdfSectionTitle(doc,data,title,y);
  y = drawTableHeader(doc,columns,y);

  if(!rows.length){
    y = ensurePageSpace(doc,data,y,10);
    doc.setFont('helvetica','normal');
    doc.setFontSize(8.5);
    doc.setTextColor(100,116,139);
    doc.text(cleanPdfText(emptyMessage || 'No records available.'),17,y);
    return y + 11;
  }

  rows.forEach((row,index)=>{
    const prepared = columns.map(col=>{
      const value = col.render ? col.render(row,index) : row[col.key];
      const maxWidth = col.wrap ? col.width - 3 : col.width - 2;
      const lines = col.wrap ? pdfWrappedLines(doc,value,maxWidth) : [cleanPdfText(value)];
      return { ...col, lines };
    });

    const maxLines = Math.max(...prepared.map(col=>col.lines.length),1);
    const rowHeight = Math.max(9,maxLines * 4.2 + 5);

    if(y + rowHeight > pdfH(doc) - 23){
      y = newPdfPage(doc,data);
      y = drawTableHeader(doc,columns,y);
    }

    const alt = index % 2 !== 0;
    doc.setFillColor(alt ? 248 : 255, alt ? 250 : 255, alt ? 252 : 255);
    doc.setDrawColor(241,245,249);
    doc.rect(14,y-5,182,rowHeight,'FD');

    doc.setFont('helvetica','normal');
    doc.setFontSize(8);
    doc.setTextColor(30,41,59);

    let x = 17;
    prepared.forEach(col=>{
      const alignRight = col.align === 'right';
      const textX = alignRight ? x + col.width - 3 : x;
      const visibleLines = col.wrap ? col.lines : [col.lines[0].length > (col.max || 20) ? col.lines[0].slice(0,(col.max || 20)-1) + '…' : col.lines[0]];

      visibleLines.forEach((line,lineIndex)=>{
        doc.text(cleanPdfText(line),textX,y + (lineIndex * 4.2),{align:alignRight?'right':'left'});
      });

      x += col.width;
    });

    y += rowHeight;
  });

  return y + 7;
}

function pdfInsights(doc,data,y){
  y = pdfSectionTitle(doc,data,'AI FINANCIAL INSIGHTS',y);
  doc.setFont('helvetica','normal');
  doc.setFontSize(8.8);
  doc.setTextColor(51,65,85);

  (data.insights || []).forEach(insight=>{
    const lines = pdfWrappedLines(doc,`• ${insight}`,176);
    const needed = lines.length * 4.7 + 3;

    y = ensurePageSpace(doc,data,y,needed);
    lines.forEach(line=>{
      doc.text(cleanPdfText(line),16,y);
      y += 4.7;
    });
    y += 1.5;
  });

  return y + 4;
}

async function createStatementPdf(data, mode='download'){
  if(!window.jspdf) throw new Error('jsPDF is not loaded.');

  const { jsPDF } = window.jspdf;
  const doc = new jsPDF('p','mm','a4');
  const file = statementFileName(data.from,data.to);

  const userName = userData.name || currentUser.displayName || 'FINORA User';
  const userEmail = userData.email || currentUser.email || '-';
  const userId = uid() || '-';

  pdfHeader(doc,data);
  let y = 49;

  y = pdfSectionTitle(doc,data,'USER DETAILS',y);
  y = pdfKeyValue(doc,data,[
    {label:'Name',value:userName},
    {label:'Email',value:userEmail},
    {label:'User ID',value:userId}
  ],y);

  y = pdfSectionTitle(doc,data,'FINANCIAL SUMMARY',y);
  y = pdfSummaryGrid(doc,data,[
    {label:'Total Income',value:formatPdfCurrency(data.totalIncome)},
    {label:'Total Expenses',value:formatPdfCurrency(data.totalExpenses)},
    {label:'Total Savings',value:formatPdfCurrency(data.totalSavings)},
    {label:'Current Balance',value:formatPdfCurrency(data.currentBalance)},
    {label:'Savings Rate',value:`${Math.round(savingsRatePercent(data))}%`},
    {label:'Budget Utilization',value:`${data.budgetUtilization}%`},
    {label:'Health Score',value:`${data.healthScore}/100`}
  ],y);

  y = drawPdfTable(doc,data,'MAIN STATEMENT TABLE',data.statementRows,[
    {label:'Date',key:'date',width:27,render:r=>formatStatementDate(r.date)},
    {label:'Description',key:'description',width:66,wrap:true},
    {label:'Income',key:'income',width:28,align:'right',render:r=>r.income ? formatPdfCurrency(r.income) : '-'},
    {label:'Expense',key:'expense',width:28,align:'right',render:r=>r.expense ? formatPdfCurrency(r.expense) : '-'},
    {label:'Running Total',key:'runningTotal',width:33,align:'right',render:r=>formatPdfCurrency(r.runningTotal)}
  ],y,'No transactions found for this statement period.');

  if(data.spendingRows.length){
    y = drawPdfTable(doc,data,'SPENDING ANALYSIS',data.spendingRows,[
      {label:'Category',key:'category',width:82,wrap:true},
      {label:'Amount',key:'amount',width:50,align:'right',render:r=>formatPdfCurrency(r.amount)},
      {label:'Percentage',key:'percentage',width:50,align:'right',render:r=>`${Number(r.percentage || 0).toFixed(1)}%`}
    ],y);
  }

  y = drawPdfTable(doc,data,'GOALS SUMMARY',data.goalRows,[
    {label:'Goal',key:'name',width:74,wrap:true},
    {label:'Target',key:'target',width:36,align:'right',render:r=>formatPdfCurrency(r.target)},
    {label:'Current',key:'current',width:36,align:'right',render:r=>formatPdfCurrency(r.current)},
    {label:'Progress %',key:'progress',width:36,align:'right',render:r=>`${r.progress}%`}
  ],y,'No financial goals created.');

  if(data.budgetRows.length){
    y = drawPdfTable(doc,data,'BUDGET SUMMARY',data.budgetRows,[
      {label:'Category',key:'category',width:54,wrap:true},
      {label:'Budget',key:'budget',width:42,align:'right',render:r=>formatPdfCurrency(r.budget)},
      {label:'Spent',key:'spent',width:42,align:'right',render:r=>formatPdfCurrency(r.spent)},
      {label:'Remaining',key:'remaining',width:44,align:'right',render:r=>formatPdfCurrency(r.remaining)}
    ],y);
  }

  y = pdfInsights(doc,data,y);

  pdfFooter(doc);

  if(mode === 'blob') return { blob:doc.output('blob'), file, base64:doc.output('datauristring') };
  if(mode === 'view') window.open(doc.output('bloburl'),'_blank');
  else doc.save(file);

  return { file };
}

async function saveStatementMetadata(data, emailed=false){
  const statementName = statementFileName(data.from,data.to);
  const payload = {
    userId:uid(),
    dateRange:`${data.from} to ${data.to}`,
    fromDate:data.from,
    toDate:data.to,
    generatedAt:serverTimestamp(),
    statementName,
    pdfFileName:statementName,
    type:'custom',
    emailed:!!emailed,
    totalIncome:data.totalIncome,
    totalExpenses:data.totalExpenses,
    totalSavings:data.totalSavings,
    financialHealthScore:data.healthScore,
    healthScore:data.healthScore
  };

  const ref = await addDoc(collection(db,'users',uid(),'statements'),payload);
  await updateDoc(ref,{statementId:ref.id});
  cache.statements.unshift({id:ref.id,statementId:ref.id,...payload,generatedAt:new Date().toISOString()});
  renderStatementHistory();
  await audit(emailed?'STATEMENT_EMAILED':'STATEMENT_GENERATED',{fromDate:data.from,toDate:data.to,emailed});
  return ref.id;
}

async function generateStatementPreview(){
  try{
    const {from,to} = getStatementRange();
    setStatementStatus('Generating statement preview...');
    const data = buildStatementData(from,to);
    renderStatementPreview(data);
    await saveStatementMetadata(data,false);
    setStatementStatus('Statement generated successfully. You can download or email it now.');
    toast('Statement generated');
  }catch(e){
    setStatementStatus(e.message,true);
    toast(e.message,true);
  }
}

async function downloadCustomStatement(data=window.finoraLastStatementData){
  try{
    if(!data){
      const r = getStatementRange();
      data = buildStatementData(r.from,r.to);
      renderStatementPreview(data);
    }

    setStatementStatus('Preparing PDF download...');
    await createStatementPdf(data,'download');
    await audit('EXPORT_PDF',{fromDate:data.from,toDate:data.to,statement:true});
    setStatementStatus('PDF downloaded successfully.');
  }catch(e){
    setStatementStatus(e.message,true);
    toast(e.message,true);
  }
}

async function emailCustomStatement(data=window.finoraLastStatementData){
  const btn = $('#emailStatement');

  try{
    if(!data){
      const r = getStatementRange();
      data = buildStatementData(r.from,r.to);
      renderStatementPreview(data);
    }

    if(btn){
      btn.disabled = true;
      btn.textContent = 'Sending Statement...';
    }

    setStatementStatus('Sending Statement...');

    const payload = statementEmailPayload({
      user:{...userData,displayName:currentUser.displayName,email:userData.email||currentUser.email},
      statement:{...data,dateRange:`${data.from} to ${data.to}`,fromDate:data.from,toDate:data.to},
      loginUrl:new URL('index.html',location.href).href
    });

    const response = await sendEmail('statement',payload);
    await saveStatementMetadata(data,true);
    await audit('STATEMENT_EMAILED',{fromDate:data.from,toDate:data.to,email:userData.email||currentUser.email,skipped:response.skipped||false});

    if(!response.ok) throw new Error('Unable to send email.');

    setStatementStatus(response.skipped ? 'EmailJS is not configured. Statement metadata was saved.' : 'Statement emailed successfully.');
    toast(response.skipped ? 'EmailJS not configured' : 'Statement emailed successfully.');
  }catch(e){
    setStatementStatus('Unable to send email.',true);
    toast('Unable to send email.',true);
  }finally{
    if(btn){
      btn.disabled = false;
      btn.textContent = 'Send Statement to Email';
    }
  }
}

function renderStatementHistory(){
  const table = $('#statementHistoryTable');
  if(!table) return;

  const rows = [...(cache.statements || [])]
    .sort((a,b)=>String(b.generatedAt?.seconds || b.generatedAt || '').localeCompare(String(a.generatedAt?.seconds || a.generatedAt || '')))
    .slice(0,20);

  table.innerHTML = `<thead><tr><th>Statement Name</th><th>Date Range</th><th>Generated Date</th><th>Email</th><th>Actions</th></tr></thead><tbody>${rows.map(r=>{
    const gen = r.generatedAt?.toDate ? r.generatedAt.toDate().toLocaleString() : (r.generatedAt ? new Date(r.generatedAt).toLocaleString() : 'Just now');
    return `<tr><td>${safeText(r.statementName)}</td><td>${safeText(r.fromDate)} to ${safeText(r.toDate)}</td><td>${gen}</td><td>${r.emailed?'Yes':'No'}</td><td><button class="btn" data-stmt-download="${safeText(r.fromDate)}|${safeText(r.toDate)}">Download</button> <button class="btn" data-stmt-email="${safeText(r.fromDate)}|${safeText(r.toDate)}">Email Again</button></td></tr>`;
  }).join('') || '<tr><td colspan="5"><div class="empty">No statements generated yet.</div></td></tr>'}</tbody>`;

  $$('[data-stmt-download]').forEach(b=>{
    b.onclick = () => {
      const [from,to] = b.dataset.stmtDownload.split('|');
      const data = buildStatementData(from,to);
      renderStatementPreview(data);
      downloadCustomStatement(data);
    };
  });

  $$('[data-stmt-email]').forEach(b=>{
    b.onclick = () => {
      const [from,to] = b.dataset.stmtEmail.split('|');
      const data = buildStatementData(from,to);
      renderStatementPreview(data);
      emailCustomStatement(data);
    };
  });
}

async function statement(viewOnly=false){
  const from = new Date(new Date().getFullYear(),new Date().getMonth(),1).toISOString().slice(0,10);
  const to = today();
  const data = buildStatementData(from,to);
  renderStatementPreview(data);
  await createStatementPdf(data,viewOnly?'view':'download');
  await saveStatementMetadata(data,false);
  toast('Statement generated');
}

async function compressImage(file){
  const img = await new Promise((res,rej)=>{
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = URL.createObjectURL(file);
  });

  const canvas = document.createElement('canvas');
  const max = 512;
  const scale = Math.min(1,max/Math.max(img.width,img.height));
  canvas.width = Math.round(img.width*scale);
  canvas.height = Math.round(img.height*scale);
  canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);
  return await new Promise(res=>canvas.toBlob(res,'image/jpeg',0.82));
}

async function uploadPhoto(file){
  if(!storage) return toast('Firebase Storage is not configured.',true);

  const blob = await compressImage(file);
  const path = `profileImages/${uid()}/profile.jpg`;
  const storageRef = ref(storage,path);
  await uploadBytes(storageRef,blob,{contentType:'image/jpeg'});
  const url = await getDownloadURL(storageRef);

  await updateDoc(doc(db,'users',uid()),{photoURL:url,updatedAt:serverTimestamp()});
  await updateProfile(currentUser,{photoURL:url});

  userData.photoURL = url;
  const prev = $('#profilePreview');
  if(prev){
    prev.src = url;
    prev.hidden = false;
  }

  await audit('PROFILE_UPDATED');
  toast('Profile photo uploaded');
}

function seedOptions(){
  $('#incomeFilter').innerHTML = '<option value="">All Categories</option>' + incomeCats.map(c=>`<option>${c}</option>`).join('');
  $('#expenseFilter').innerHTML = '<option value="">All Categories</option>' + expenseCats.map(c=>`<option>${c}</option>`).join('');
}

function bind(){
  $$('.nav-link[data-page]').forEach(b=>b.onclick=()=>showPage(b.dataset.page));
  $('#menuBtn').onclick = () => $('#sidebar').classList.toggle('open');
  $('#themeToggle').onclick = () => {
    document.body.classList.toggle('light');
    localStorage.setItem('finoraTheme',document.body.classList.contains('light')?'light':'dark');
    renderCharts();
  };

  if(localStorage.finoraTheme === 'light') document.body.classList.add('light');

  $$('#dataForm').forEach(f=>f.onsubmit=saveForm);
  $$('[data-open-modal]').forEach(b=>b.onclick=()=>openModal(b.dataset.openModal));

  ['incomeSearch','incomeFilter','expenseSearch','expenseFilter'].forEach(id=>$('#'+id).oninput=renderIncomeExpense);

  $('#txSearch').oninput = () => { page=1; renderTransactions(); };
  $('#txSort').onchange = renderTransactions;
  $('#prevPage').onclick = () => { page=Math.max(1,page-1); renderTransactions(); };
  $('#nextPage').onclick = () => { page++; renderTransactions(); };

  $('#exportCsv').onclick = csv;
  $('#exportExcel').onclick = excel;
  $('#exportPdf').onclick = pdf;
  $('#generateStatement').onclick = generateStatementPreview;
  $('#downloadStatement').onclick = () => downloadCustomStatement();
  $('#emailStatement').onclick = () => emailCustomStatement();
  $('#runRecurring').onclick = () => generateDueRecurring(true).then(()=>loadAll(true));
  $('#refreshReports').onclick = () => renderCharts();

  $('#photoInput').onchange = e => e.target.files[0] && uploadPhoto(e.target.files[0]);

  $('#removePhoto').onclick = async()=>{
    try{
      if(storage){
        await deleteObject(ref(storage,`profileImages/${uid()}/profile.jpg`)).catch(()=>{});
      }
      await updateDoc(doc(db,'users',uid()),{photoURL:'',updatedAt:serverTimestamp()});
      await updateProfile(currentUser,{photoURL:''});
      userData.photoURL = '';
      const prev = $('#profilePreview');
      if(prev){
        prev.hidden = true;
        prev.removeAttribute('src');
      }
      await audit('PROFILE_UPDATED');
      toast('Profile photo removed');
    }catch(e){
      toast(e.message,true);
    }
  };

  $('#saveProfile').onclick = async()=>{
    await updateDoc(doc(db,'users',uid()),{name:$('#profileName').value,updatedAt:serverTimestamp()});
    await updateProfile(currentUser,{displayName:$('#profileName').value});
    await audit('PROFILE_UPDATED');
    toast('Profile updated');
  };

  $('#changePassword').onclick = async()=>{
    await sendPasswordResetEmail(auth,currentUser.email);
    await sendEmail('reset',{to_email:currentUser.email,user_name:userData.name||currentUser.displayName||'FINORA User'});
    toast('Password reset email sent');
  };

  $('#emailVerify').onclick = async()=>{
    await sendEmailVerification(currentUser);
    toast('Verification email sent');
  };

  $('#logoutBtn').onclick = async()=>{
    await audit('LOGOUT');
    sessionStorage.clear();
    await signOut(auth);
    location.href = 'index.html';
  };

  window.addEventListener('offline',()=>toast('Offline mode: cached data may be shown.',true));
  window.addEventListener('online',()=>{toast('Back online'); loadAll(true);});
}

bind();

if(!hasConfig){
  toast('Firebase config missing. Add keys in firebase-config.js.', true);
  throw new Error('Firebase configuration missing');
}

onAuthStateChanged(auth, async u => {
  if(!u){
    location.href = 'index.html';
    return;
  }

  currentUser = u;

  try{
    const snap = await getDoc(doc(db,'users',u.uid));

    if(!snap.exists()){
      await signOut(auth);
      location.href = 'index.html';
      return;
    }

    userData = snap.data();

    if(!userData.approved || userData.status !== 'active'){
      await signOut(auth);
      location.href = 'index.html';
      return;
    }

    if(!u.emailVerified && userData.role !== 'super_admin'){
      toast('Please verify your email before accessing FINORA.', true);
      await signOut(auth);
      location.href = 'index.html';
      return;
    }

    startSessionSecurity();
    $('#userLine').textContent = `${userData.name || u.email} • ${userData.role}`;
    seedOptions();
    await loadAll(true);
  }catch(err){
    toast(err.message,true);
  }
});
