// Replace only the existing Statement PDF generation section in app.js
// from: function categoryRows(...)
// to: before async function saveStatementMetadata(...)

function categoryRows(map){ return Object.entries(map).sort((a,b)=>b[1]-a[1]); }
function rangeMonths(from,to){ const out=[]; const d=new Date(from+'T00:00:00'), end=new Date(to+'T00:00:00'); d.setDate(1); while(d<=end){ out.push(d.toISOString().slice(0,7)); d.setMonth(d.getMonth()+1); if(out.length>36) break; } return out; }
function budgetUtilizationFor(expenses){ const expCat=byCat(expenses); const monthlyBudget=Number(cache.budgets.find(b=>b.category==='Monthly')?.amount||0); const categoryBudgetTotal=cache.budgets.filter(b=>b.category!=='Monthly').reduce((total,b)=>total+Number(b.amount||0),0); const budgetBase=monthlyBudget || categoryBudgetTotal || sum(expenses) || 1; return Math.min(100, Math.round(sum(expenses)/budgetBase*100)); }
function statementHealth(data){ const savingsRate=data.totalIncome?data.totalSavings/data.totalIncome*100:0; const budgetScore=Math.max(0,100-data.budgetUtilization); const savingScore=Math.max(0,Math.min(100,savingsRate*2)); const expenseScore=data.totalIncome?Math.max(0,100-(data.totalExpenses/data.totalIncome*100)):50; const goalPct=cache.goals.length?cache.goals.reduce((a,g)=>a+Math.min(100,Number(g.current||0)/Number(g.target||1)*100),0)/cache.goals.length:70; return Math.round(savingScore*.35+budgetScore*.25+expenseScore*.25+goalPct*.15); }
function buildStatementData(from,to){ const income=cache.income.filter(r=>dateInRange(r,from,to)).sort((a,b)=>a.date.localeCompare(b.date)); const expenses=cache.expenses.filter(r=>dateInRange(r,from,to)).sort((a,b)=>a.date.localeCompare(b.date)); const totalIncome=sum(income), totalExpenses=sum(expenses), totalSavings=totalIncome-totalExpenses; const openingBalance=sum(cache.income.filter(r=>(r.date||'')<from))-sum(cache.expenses.filter(r=>(r.date||'')<from)); const data={from,to,income,expenses,budgets:cache.budgets,goals:cache.goals,totalIncome,totalExpenses,totalSavings,currentBalance:openingBalance+totalSavings,openingBalance,budgetUtilization:budgetUtilizationFor(expenses)}; data.healthScore=statementHealth(data); data.expenseCats=byCat(expenses); data.incomeCats=byCat(income); data.months=rangeMonths(from,to); data.monthIncome=data.months.map(m=>sum(income.filter(x=>monthKey(x.date)===m))); data.monthExpense=data.months.map(m=>sum(expenses.filter(x=>monthKey(x.date)===m))); data.monthSavings=data.monthIncome.map((v,i)=>v-data.monthExpense[i]); data.statementRows=buildStatementRows(data); data.budgetRows=buildBudgetRows(data); data.insights=statementInsights(data); return data; }
function statementInsights(data){ const topExpense=categoryRows(data.expenseCats)[0]; const topIncome=categoryRows(data.incomeCats)[0]; const savingsRate=data.totalIncome?Math.round(data.totalSavings/data.totalIncome*100):0; const trend=data.monthSavings.length>1?data.monthSavings.at(-1)-data.monthSavings.at(-2):data.totalSavings; const budgetText=data.budgetUtilization>90?'Budget performance needs attention because utilization crossed 90%.':data.budgetUtilization>70?'Budget performance is moderate. Continue monitoring discretionary categories.':'Budget performance is healthy for the selected period.'; return [
  `Savings Rate: You saved ${savingsRate}% of your income during this period.`,
  topExpense?`Highest Spending Category: ${topExpense[0]} with ${money(topExpense[1])}.`:'Highest Spending Category: No expenses recorded in this period.',
  trend>=0?'Spending Pattern: Your savings trend is positive for the selected period.':'Spending Pattern: Your savings trend declined in the selected period.',
  `Budget Performance: ${budgetText}`,
  data.totalSavings>0?'Personalized Recommendation: Move part of your savings into goals or emergency funds.':'Personalized Recommendation: Reduce non-essential spending and set a strict category budget.',
  topIncome?`Highest Income Category: ${topIncome[0]} with ${money(topIncome[1])}.`:'Highest Income Category: No income recorded in this period.'
]; }

function setStatementStatus(text,bad=false){ const el=$('#statementStatus'); if(!el) return; el.textContent=text; el.className='message show'+(bad?' error':''); }
function renderStatementCharts(data){ chart('statementExpensePie','pie',Object.keys(data.expenseCats),Object.values(data.expenseCats)); chart('statementIncomePie','pie',Object.keys(data.incomeCats),Object.values(data.incomeCats)); chart('statementIncomeExpenseBar','bar',['Income','Expenses'],[data.totalIncome,data.totalExpenses]); chart('statementSavingsTrend','line',data.months,data.monthSavings,'Savings'); }
function renderStatementPreview(data){ const p=$('#statementPreview'); if(!p) return; const hasTx=data.income.length||data.expenses.length; p.innerHTML=`<div class="statement-head"><div class="logo-mark">F</div><div><h3>FINORA Financial Statement</h3><p class="muted">${safeText(formatDateDDMMMYYYY(data.from))} to ${safeText(formatDateDDMMMYYYY(data.to))}</p></div></div><div class="cards grid statement-mini"><div class="card"><h3>Total Income</h3><div class="value">${money(data.totalIncome)}</div></div><div class="card"><h3>Total Expenses</h3><div class="value">${money(data.totalExpenses)}</div></div><div class="card"><h3>Savings</h3><div class="value">${money(data.totalSavings)}</div></div><div class="card"><h3>Health Score</h3><div class="value">${data.healthScore}/100</div></div></div>${hasTx?'':'<div class="empty">No transactions found in this date range. Statement can still include budgets and goals.</div>'}<h3>AI Insights</h3>${data.insights.map(i=>`<div class="insight">${safeText(i)}</div>`).join('')}`; renderStatementCharts(data); $('#downloadStatement').disabled=false; $('#emailStatement').disabled=false; window.finoraLastStatementData=data; }

function formatDateDDMMMYYYY(value){ if(!value) return '-'; const d=new Date(String(value).includes('T')?value:value+'T00:00:00'); if(Number.isNaN(d.getTime())) return String(value); return d.toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}).replace(/ /g,'-'); }
function cleanPdfText(value){ return String(value??'').replace(/¹/g,'').replace(/[\u0000-\u001F\u007F]/g,' ').trim(); }
function pdfMoney(value){ return `₹${Number(value||0).toLocaleString('en-IN',{maximumFractionDigits:2})}`; }
function pdfPercent(value){ return `${Number(value||0).toLocaleString('en-IN',{maximumFractionDigits:1})}%`; }
function savingsRate(data){ return data.totalIncome?((data.totalIncome-data.totalExpenses)/data.totalIncome)*100:0; }
function buildDescription(row,type){ const cat=row.category||type; const notes=row.description||row.notes||''; return notes?`${cat} - ${notes}`:cat; }
function buildStatementRows(data){ let running=Number(data.openingBalance||0); const rows=[]; rows.push({date:data.from,description:'Opening Balance',income:running>0?running:0,expense:running<0?Math.abs(running):0,running}); const tx=[...data.income.map(r=>({type:'income',date:r.date,description:buildDescription(r,'Income'),amount:Number(r.amount||0),id:r.id||''})),...data.expenses.map(r=>({type:'expense',date:r.date,description:buildDescription(r,'Expense'),amount:Number(r.amount||0),id:r.id||''}))].sort((a,b)=>String(a.date).localeCompare(String(b.date)) || a.type.localeCompare(b.type) || String(a.id).localeCompare(String(b.id))); tx.forEach(t=>{ if(t.type==='income') running+=t.amount; else running-=t.amount; rows.push({date:t.date,description:t.description,income:t.type==='income'?t.amount:null,expense:t.type==='expense'?t.amount:null,running}); }); return rows; }
function buildBudgetRows(data){ const spentByCategory=byCat(data.expenses); return cache.budgets.map(b=>{ const budget=Number(b.amount||0); const spent=b.category==='Monthly'?data.totalExpenses:Number(spentByCategory[b.category]||0); const remaining=budget-spent; return {category:b.category,budget,spent,remaining}; }).filter(r=>r.category && Number(r.budget||0)>0); }

function addPdfHeader(doc,data){ doc.setFillColor(7,17,31); doc.rect(0,0,210,34,'F'); doc.setTextColor(255,255,255); doc.setFont('helvetica','bold'); doc.setFontSize(20); doc.text('FINORA',14,13); doc.setFont('helvetica','normal'); doc.setFontSize(8.5); doc.text('AI Powered Personal Finance Management',14,20); doc.setFont('helvetica','bold'); doc.setFontSize(13); doc.text('FINANCIAL STATEMENT',132,13); doc.setFont('helvetica','normal'); doc.setFontSize(8.5); doc.text(`Generated Date: ${formatDateDDMMMYYYY(new Date().toISOString().slice(0,10))}`,132,20); doc.text(`Statement Period: ${formatDateDDMMMYYYY(data.from)} to ${formatDateDDMMMYYYY(data.to)}`,132,26); doc.setDrawColor(245,158,11); doc.setLineWidth(0.8); doc.line(14,31,196,31); }
function addPdfFooter(doc){ const total=doc.internal.getNumberOfPages(); for(let i=1;i<=total;i++){ doc.setPage(i); doc.setDrawColor(226,232,240); doc.line(14,286,196,286); doc.setTextColor(100,116,139); doc.setFont('helvetica','normal'); doc.setFontSize(8); doc.text('Generated by FINORA AI',14,292); doc.text('Confidential Financial Statement',79,292); doc.text(`Page ${i} of ${total}`,178,292); } }
function ensurePdfPage(doc,data,y,needed=18){ if(y+needed<=278) return y; doc.addPage(); addPdfHeader(doc,data); return 44; }
function pdfSectionTitle(doc,title,y){ doc.setTextColor(15,23,42); doc.setFont('helvetica','bold'); doc.setFontSize(11); doc.text(cleanPdfText(title),14,y); doc.setDrawColor(226,232,240); doc.line(14,y+2,196,y+2); return y+8; }
function pdfWrapped(doc,text,x,y,width,lineHeight=4){ const lines=doc.splitTextToSize(cleanPdfText(text),width); doc.text(lines,x,y); return y+(lines.length*lineHeight); }
function pdfKeyValueGrid(doc,items,y){ doc.setFontSize(9); doc.setTextColor(51,65,85); items.forEach((item,i)=>{ const x=i%2?110:14; if(i%2===0&&i>0) y+=7; doc.setFont('helvetica','bold'); doc.text(cleanPdfText(item[0]+':'),x,y); doc.setFont('helvetica','normal'); doc.text(cleanPdfText(String(item[1])),x+38,y); }); return y+10; }

function pdfTablePro(doc,data,title,columns,rows,y,options={}){
  y=ensurePdfPage(doc,data,y,20);
  y=pdfSectionTitle(doc,title,y);
  const startX=14, tableWidth=182, rowH=7;
  doc.setFontSize(8);
  doc.setFont('helvetica','bold');
  doc.setFillColor(238,244,255);
  doc.setTextColor(15,23,42);
  doc.rect(startX,y-5,tableWidth,rowH,'F');
  let x=startX+2;
  columns.forEach(c=>{ doc.text(cleanPdfText(c.label),x,y); x+=c.width; });
  y+=rowH;
  doc.setFont('helvetica','normal');
  if(!rows.length){
    doc.setTextColor(100,116,139);
    doc.text(cleanPdfText(options.emptyText||'No records found.'),startX+2,y);
    return y+8;
  }
  rows.forEach((row,index)=>{
    y=ensurePdfPage(doc,data,y,rowH+4);
    doc.setFontSize(8);
    doc.setTextColor(30,41,59);
    doc.setFillColor(index%2?248:255,index%2?250:255,index%2?252:255);
    doc.rect(startX,y-5,tableWidth,rowH,'F');
    x=startX+2;
    columns.forEach(c=>{
      const raw=c.render?c.render(row,index):row[c.key];
      const text=cleanPdfText(raw);
      const max=c.max||Math.max(8,Math.floor(c.width/2.3));
      doc.text(text.length>max?text.slice(0,max-1)+'…':text,x,y);
      x+=c.width;
    });
    y+=rowH;
  });
  return y+6;
}

function addStatementChartsToPdf(doc,data,y){
  y=ensurePdfPage(doc,data,y,48);
  y=pdfSectionTitle(doc,'ANALYTICS',y);
  const charts=[['Expense Distribution','statementExpensePie',14],['Income Distribution','statementIncomePie',62],['Income vs Expenses','statementIncomeExpenseBar',110],['Savings Trend','statementSavingsTrend',158]];
  doc.setFont('helvetica','bold');
  doc.setFontSize(7);
  doc.setTextColor(51,65,85);
  charts.forEach(([label,id,x])=>{ doc.text(label,x,y); addChartImage(doc,id,x,y+2,38,30); });
  return y+40;
}

async function createStatementPdf(data, mode='download'){
  if(!window.jspdf) throw new Error('jsPDF is not loaded.');
  const {jsPDF}=window.jspdf;
  const doc=new jsPDF('p','mm','a4');
  const file=statementFileName(data.from,data.to);
  const userName=userData.name||currentUser.displayName||'FINORA User';
  const userEmail=userData.email||currentUser.email||'-';
  const userId=uid()||'-';
  const statementRows=data.statementRows||buildStatementRows(data);
  const budgetRows=data.budgetRows||buildBudgetRows(data);

  addPdfHeader(doc,data);
  let y=44;

  y=pdfSectionTitle(doc,'USER DETAILS',y);
  y=pdfKeyValueGrid(doc,[['Name',userName],['Email',userEmail],['User ID',userId]],y);

  y=ensurePdfPage(doc,data,y,36);
  y=pdfSectionTitle(doc,'FINANCIAL SUMMARY',y);
  y=pdfKeyValueGrid(doc,[
    ['Total Income',pdfMoney(data.totalIncome)],
    ['Total Expenses',pdfMoney(data.totalExpenses)],
    ['Total Savings',pdfMoney(data.totalSavings)],
    ['Financial Health Score',`${data.healthScore}/100`],
    ['Savings Rate',pdfPercent(savingsRate(data))],
    ['Current Balance',pdfMoney(data.currentBalance)]
  ],y);

  doc.setFontSize(8);
  doc.setTextColor(100,116,139);
  doc.setFont('helvetica','normal');
  y=pdfWrapped(doc,'Savings Rate Formula: ((Income - Expenses) / Income) * 100',14,y,180,4)+3;

  y=pdfTablePro(doc,data,'MAIN STATEMENT TABLE',[
    {label:'Date',key:'date',width:27,render:r=>formatDateDDMMMYYYY(r.date),max:12},
    {label:'Description',key:'description',width:64,max:34},
    {label:'Income',key:'income',width:29,render:r=>r.income?pdfMoney(r.income):'-',max:16},
    {label:'Expense',key:'expense',width:29,render:r=>r.expense?pdfMoney(r.expense):'-',max:16},
    {label:'Running Total',key:'running',width:31,render:r=>pdfMoney(r.running),max:17}
  ],statementRows,y,{emptyText:'No transactions found for this date range.'});

  const spendingRows=categoryRows(data.expenseCats).slice(0,8).map(([category,amount])=>({category,amount}));
  y=pdfTablePro(doc,data,'SPENDING ANALYSIS',[
    {label:'Category',key:'category',width:110,max:50},
    {label:'Amount',key:'amount',width:70,render:r=>pdfMoney(r.amount),max:22}
  ],spendingRows,y,{emptyText:'No spending categories found.'});

  const goalRows=(data.goals||[]).filter(g=>g.name||g.target||g.current).map(g=>({name:g.name||'Untitled Goal',target:Number(g.target||0),current:Number(g.current||0),progress:Number(g.target||0)?Math.round(Number(g.current||0)/Number(g.target||1)*100):0}));
  y=pdfTablePro(doc,data,'GOALS SUMMARY',[
    {label:'Goal',key:'name',width:62,max:32},
    {label:'Target',key:'target',width:38,render:r=>pdfMoney(r.target),max:18},
    {label:'Current',key:'current',width:38,render:r=>pdfMoney(r.current),max:18},
    {label:'Progress',key:'progress',width:38,render:r=>`${r.progress}%`,max:12}
  ],goalRows,y,{emptyText:'No financial goals created.'});

  y=pdfTablePro(doc,data,'BUDGET SUMMARY',[
    {label:'Category',key:'category',width:50,max:24},
    {label:'Budget',key:'budget',width:42,render:r=>pdfMoney(r.budget),max:18},
    {label:'Spent',key:'spent',width:42,render:r=>pdfMoney(r.spent),max:18},
    {label:'Remaining',key:'remaining',width:44,render:r=>pdfMoney(r.remaining),max:18}
  ],budgetRows,y,{emptyText:'No active budget categories found.'});

  y=ensurePdfPage(doc,data,y,40);
  y=pdfSectionTitle(doc,'AI INSIGHTS',y);
  doc.setFont('helvetica','normal');
  doc.setFontSize(8.5);
  doc.setTextColor(51,65,85);
  (data.insights||[]).forEach(i=>{ y=ensurePdfPage(doc,data,y,10); y=pdfWrapped(doc,'✓ '+i,16,y,176,4.4)+1; });

  y=addStatementChartsToPdf(doc,data,y+2);
  addPdfFooter(doc);

  if(mode==='blob') return {blob:doc.output('blob'), file, base64:doc.output('datauristring')};
  if(mode==='view') window.open(doc.output('bloburl'),'_blank');
  else doc.save(file);
  return {file};
}
