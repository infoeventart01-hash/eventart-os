"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Row = { id: string; fields: Record<string, unknown> };
type Props = { event: Row; onBack: () => void };

const categories = ["Planning","Design","Décor","Florals","Rentals","Catering","Bar Service","Venue","Entertainment","Photography / Video","Stationery / Signage","Transportation","Staffing","Delivery","Setup","Teardown","Taxes","Miscellaneous"];
const statuses = ["Draft","In Review","Sent","Approved","Declined","Expired"];
const clientFields = ["Item / Service","Description","Quantity","Unit Price","Discount","Taxable","Tax Rate","Pre-Tax Client Total","Tax Total","Client Line Total","Category","Custom Category","Optional Item","Included in Proposal"];
const editableFields = ["Item / Service","Description","Category","Custom Category","Quantity","Unit Cost","Unit Price","Discount","Taxable","Tax Rate","Optional Item","Included in Proposal","Notes"];

const num = (v: unknown) => Number(v || 0);
const cad = (v: unknown) => new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(num(v));
const text = (v: unknown) => Array.isArray(v) ? v.join(", ") : String(v ?? "");
const linked = (v: unknown, id: string) => Array.isArray(v) && v.includes(id);
const requestId = () => `${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function api(method: string, body?: unknown, query?: string) {
  const response = await fetch(query ? `/api/airtable?${query}` : "/api/airtable", { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const data = await response.json();
  if (!response.ok) throw new Error(typeof data.error === "string" ? data.error : data.error?.message || "Airtable request failed");
  return data;
}

export default function BudgetWorkspace({ event, onBack }: Props) {
  const [budget, setBudget] = useState<Row | null>(null);
  const [items, setItems] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [preview, setPreview] = useState(false);
  const [clientName, setClientName] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [b, i, c] = await Promise.all([api("GET", undefined, "table=Budgets&pageSize=100"), api("GET", undefined, "table=Budget%20Items&pageSize=100"), api("GET", undefined, "table=Clients&pageSize=100")]);
      const clientIds = Array.isArray(event.fields.Clients) ? event.fields.Clients : [];
      setClientName((c.records as Row[]).filter((r)=>clientIds.includes(r.id)).map((r)=>text(r.fields["Client Name"])).join(", "));
      const found = (b.records as Row[]).find((r) => linked(r.fields.Event, event.id)) || null;
      setBudget(found);
      setItems(found ? (i.records as Row[]).filter((r) => linked(r.fields.Budget, found.id)).sort((a,b) => num(a.fields["Display Order"])-num(b.fields["Display Order"])) : []);
    } catch (e) { setMessage(e instanceof Error ? e.message : "Unable to load budget"); }
    finally { setLoading(false); }
  }, [event.id]);

  useEffect(() => { load(); }, [load]);

  async function createBudget() {
    if (saving) return; setSaving(true);
    try {
      const today = new Date(); const expiry = new Date(today); expiry.setDate(expiry.getDate()+30);
      const created = await api("POST", { table:"Budgets", requestId:requestId(), fields:{ "Budget Name":`${text(event.fields["Event Name"])} Budget`, Event:[event.id], Status:"Draft", "Proposal Number":`EA-${today.getFullYear()}-${String(Date.now()).slice(-5)}`, "Proposal Date":today.toISOString().slice(0,10), "Expiration Date":expiry.toISOString().slice(0,10), Introduction:"Thank you for considering EventArt. We are delighted to present this customized event proposal.", "Scope of Services":"Event planning, design, coordination, and selected event services as detailed below.", "Event Discount":0, "Contingency Type":"Amount", "Contingency Value":0, "Deposit Required":0, "Payment Schedule":"Deposit due upon acceptance. Remaining balance due before the event date.", "Terms and Conditions":"Pricing is valid until the expiration date. Services are confirmed after signed acceptance and deposit.", "Proposal Notes":"" } });
      setBudget(created); setMessage("Budget created and linked to this event.");
    } catch(e){setMessage(e instanceof Error?e.message:"Unable to create budget");} finally{setSaving(false);}
  }

  async function saveBudget(fields: Record<string, unknown>) {
    if (!budget || saving) return; setSaving(true);
    try { const updated=await api("PATCH",{table:"Budgets",id:budget.id,fields});setBudget(updated);setMessage("Budget saved to Airtable."); }
    catch(e){setMessage(e instanceof Error?e.message:"Unable to save");}finally{setSaving(false);}
  }

  async function addItem(source?: Row) {
    if (!budget || saving) return; setSaving(true);
    const s=source?.fields||{};
    const fields:Record<string,unknown>={ "Item / Service":source?`${text(s["Item / Service"])} Copy`:"New item", Budget:[budget.id], Event:[event.id], Category:s.Category||"Planning", "Custom Category":s["Custom Category"]||"", Description:s.Description||"", Quantity:num(s.Quantity)||1, "Unit Cost":num(s["Unit Cost"]), "Unit Price":num(s["Unit Price"]), Discount:num(s.Discount), Taxable:Boolean(s.Taxable), "Tax Rate":num(s["Tax Rate"])||0.13, Notes:s.Notes||"", "Optional Item":Boolean(s["Optional Item"]), "Included in Proposal":source?Boolean(s["Included in Proposal"]):true, "Display Order":items.length+1 };
    try{const created=await api("POST",{table:"Budget Items",requestId:requestId(),fields});setItems((old)=>[...old,created]);setMessage(source?"Item duplicated.":"Budget item added.");}catch(e){setMessage(e instanceof Error?e.message:"Unable to add item");}finally{setSaving(false);}
  }

  async function updateItem(item:Row,fields:Record<string,unknown>){
    try{const updated=await api("PATCH",{table:"Budget Items",id:item.id,fields});setItems((old)=>old.map((r)=>r.id===item.id?updated:r));}catch(e){setMessage(e instanceof Error?e.message:"Unable to update item");}
  }
  async function removeItem(item:Row){if(!confirm(`Delete “${text(item.fields["Item / Service"])}”? This cannot be undone.`))return;try{await api("DELETE",{table:"Budget Items",id:item.id});setItems((old)=>old.filter((r)=>r.id!==item.id));setMessage("Budget item deleted.");}catch(e){setMessage(e instanceof Error?e.message:"Unable to delete item");}}
  async function move(item:Row,delta:number){const index=items.findIndex((r)=>r.id===item.id);const target=index+delta;if(target<0||target>=items.length)return;const other=items[target];await Promise.all([updateItem(item,{"Display Order":target+1}),updateItem(other,{"Display Order":index+1})]);await load();}

  if(loading)return <div className="budget-loading">Loading Budget & Proposal…</div>;
  if(!budget)return <div className="budget-empty"><button className="back-link" onClick={onBack}>← Back to Events</button><span>EVENTART OS</span><h1>Budget & Proposal</h1><p>Create a detailed budget and branded proposal for <b>{text(event.fields["Event Name"])}</b>.</p>{message&&<div className="notice">{message}</div>}<button className="gold-button" disabled={saving} onClick={createBudget}>Create Event Budget</button></div>;

  const f=budget.fields;
  return <div className="budget-module">
    <div className="budget-top"><div><button className="back-link" onClick={onBack}>← Events</button><p className="eyebrow">EVENT DETAIL / BUDGET & PROPOSAL</p><h1>{text(event.fields["Event Name"])}</h1><div className="event-meta"><span>{clientName||"Client"}</span><span>{event.fields["Ceremony Date & Time"]?new Date(text(event.fields["Ceremony Date & Time"])).toLocaleDateString("en-CA"):"Date TBD"}</span><span>{text(event.fields["Venue Name"])||"Venue TBD"}</span><span>{text(event.fields["Guest Count"])||"0"} guests</span></div></div><div className="budget-actions"><button onClick={()=>saveBudget({Status:f.Status})}>Save Budget</button><button onClick={()=>downloadCSV(items,event)}>Download CSV</button><button onClick={()=>setPreview(true)}>Preview Proposal</button><button onClick={()=>{setPreview(true);setTimeout(()=>window.print(),300)}}>Print Proposal</button><button className="gold-button" onClick={()=>downloadProposalPDF(event,budget,items,clientName)}>Download Proposal PDF</button></div></div>
    {message&&<div className="notice">{message}</div>}
    <section className="budget-card proposal-settings"><div className="budget-card-head"><h2>Proposal details</h2><StatusButtons status={text(f.Status)} onChange={(Status)=>saveBudget({Status})}/></div><div className="budget-form-grid">
      <Field label="Proposal number" value={f["Proposal Number"]} onBlur={(v)=>saveBudget({"Proposal Number":v})}/><Field label="Proposal date" type="date" value={f["Proposal Date"]} onBlur={(v)=>saveBudget({"Proposal Date":v})}/><Field label="Expiration date" type="date" value={f["Expiration Date"]} onBlur={(v)=>saveBudget({"Expiration Date":v})}/><Field label="Deposit required" type="number" value={f["Deposit Required"]} onBlur={(v)=>saveBudget({"Deposit Required":num(v)})}/>
      <Field label="Introduction" area value={f.Introduction} onBlur={(v)=>saveBudget({Introduction:v})}/><Field label="Scope of services" area value={f["Scope of Services"]} onBlur={(v)=>saveBudget({"Scope of Services":v})}/><Field label="Payment schedule" area value={f["Payment Schedule"]} onBlur={(v)=>saveBudget({"Payment Schedule":v})}/><Field label="Terms and conditions" area value={f["Terms and Conditions"]} onBlur={(v)=>saveBudget({"Terms and Conditions":v})}/><Field label="Private proposal notes" area value={f["Proposal Notes"]} onBlur={(v)=>saveBudget({"Proposal Notes":v})}/>
    </div></section>
    <section className="budget-card"><div className="budget-card-head"><h2>Budget line items</h2><button className="gold-button" disabled={saving} onClick={()=>addItem()}>+ Add Budget Item</button></div><div className="budget-table-wrap"><table className="budget-table"><thead><tr><th>Order</th><th>Item / Service</th><th>Category</th><th>Qty</th><th>Unit Cost</th><th>Unit Price</th><th>Discount</th><th>Tax</th><th>Client Total</th><th>Options</th><th>Actions</th></tr></thead><tbody>{items.map((item,index)=><BudgetRow key={item.id} item={item} index={index} onSave={updateItem} onDuplicate={()=>addItem(item)} onDelete={()=>removeItem(item)} onMove={(d)=>move(item,d)}/>)}</tbody></table>{!items.length&&<div className="no-records">Add your first customized budget item.</div>}</div></section>
    <section className="budget-summary"><div className="internal-summary"><h3>Internal business view</h3><Summary label="Total internal cost" value={f["Total Internal Cost"]}/><Summary label="Estimated profit" value={f["Estimated Profit"]}/><Summary label="Profit margin" value={`${(num(f["Profit Margin %"])*100).toFixed(1)}%`} plain/></div><div className="client-summary"><h3>Client totals</h3><Summary label="Subtotal" value={f.Subtotal}/><Summary label="Item discounts" value={f["Item Discounts"]}/><div className="summary-edit"><label>Event discount</label><input type="number" defaultValue={num(f["Event Discount"])} onBlur={(e)=>saveBudget({"Event Discount":num(e.target.value)})}/></div><Summary label="Tax" value={f.Tax}/><div className="summary-edit"><label>Contingency</label><select defaultValue={text(f["Contingency Type"])} onChange={(e)=>saveBudget({"Contingency Type":e.target.value})}><option>Amount</option><option>Percentage</option></select><input type="number" defaultValue={num(f["Contingency Value"])} onBlur={(e)=>saveBudget({"Contingency Value":num(e.target.value)})}/></div><Summary label="Total client price" value={f["Total Client Price"]} total/><Summary label="Deposit required" value={f["Deposit Required"]}/><Summary label="Remaining balance" value={f["Remaining Balance"]} total/></div></section>
    {preview&&<ProposalPreview event={event} budget={budget} items={items} clientName={clientName} onClose={()=>setPreview(false)}/>} 
  </div>;
}

function StatusButtons({status,onChange}:{status:string;onChange:(s:string)=>void}){return <div className="status-actions">{statuses.map((s)=><button key={s} className={status===s?"selected":""} onClick={()=>onChange(s)}>{s}</button>)}</div>}
function Field({label,value,onBlur,type="text",area=false}:{label:string;value:unknown;onBlur:(v:string)=>void;type?:string;area?:boolean}){const props={defaultValue:text(value),onBlur:(e:React.FocusEvent<HTMLInputElement|HTMLTextAreaElement>)=>onBlur(e.target.value)};return <label className={area?"wide":""}><span>{label}</span>{area?<textarea {...props}/>:<input type={type} {...props}/>}</label>}
function Summary({label,value,total,plain}:{label:string;value:unknown;total?:boolean;plain?:boolean}){return <div className={total?"summary-line total":"summary-line"}><span>{label}</span><b>{plain?text(value):cad(value)}</b></div>}

function BudgetRow({item,index,onSave,onDuplicate,onDelete,onMove}:{item:Row;index:number;onSave:(r:Row,f:Record<string,unknown>)=>void;onDuplicate:()=>void;onDelete:()=>void;onMove:(d:number)=>void}){const f=item.fields;const input=(name:string,type="text")=><input type={type} defaultValue={type==="checkbox"?undefined:text(f[name])} defaultChecked={type==="checkbox"?Boolean(f[name]):undefined} onBlur={(e)=>type!=="checkbox"&&onSave(item,{[name]:type==="number"?num(e.target.value):e.target.value})} onChange={(e)=>type==="checkbox"&&onSave(item,{[name]:e.target.checked})}/>;return <tr><td><button onClick={()=>onMove(-1)}>↑</button><button onClick={()=>onMove(1)}>↓</button></td><td>{input("Item / Service")}</td><td><select defaultValue={text(f.Category)} onChange={(e)=>onSave(item,{Category:e.target.value})}>{categories.map((c)=><option key={c}>{c}</option>)}</select></td><td>{input("Quantity","number")}</td><td>{input("Unit Cost","number")}</td><td>{input("Unit Price","number")}</td><td>{input("Discount","number")}</td><td><label className="tiny-check">{input("Taxable","checkbox")}<span>{(num(f["Tax Rate"])*100).toFixed(0)}%</span></label></td><td><b>{cad(f["Client Line Total"])}</b></td><td><label className="tiny-check">{input("Optional Item","checkbox")}<span>Optional</span></label><label className="tiny-check">{input("Included in Proposal","checkbox")}<span>Include</span></label></td><td><button onClick={onDuplicate}>Duplicate</button><button className="danger" onClick={onDelete}>Delete</button></td></tr>}

function ProposalPreview({event,budget,items,clientName,onClose}:{event:Row;budget:Row;items:Row[];clientName:string;onClose:()=>void}){const f=budget.fields;const included=items.filter((i)=>i.fields["Included in Proposal"]&&!i.fields["Optional Item"]);const optional=items.filter((i)=>i.fields["Optional Item"]);return <div className="proposal-overlay"><button className="proposal-scrim" onClick={onClose}/><article className="proposal-paper"><button className="proposal-close" onClick={onClose}>×</button><header><div className="proposal-logo">EA</div><div><h1>EventArt</h1><p>EVENT DESIGN & COORDINATION</p></div><aside><b>PROPOSAL</b><span>{text(f["Proposal Number"])}</span></aside></header><section className="proposal-intro"><p>PREPARED FOR</p><h2>{clientName||"Valued Client"}</h2><h3>{text(event.fields["Event Name"])}</h3><div><span>{event.fields["Ceremony Date & Time"]?new Date(text(event.fields["Ceremony Date & Time"])).toLocaleDateString("en-CA"):"Date TBD"}</span><span>{text(event.fields["Venue Name"])}</span></div></section><p>{text(f.Introduction)}</p><h3 className="proposal-heading">Scope of Services</h3><p>{text(f["Scope of Services"])}</p><ProposalItems items={included}/>{optional.length>0&&<><h3 className="proposal-heading">Optional Upgrades</h3><ProposalItems items={optional} optional/></>}<div className="proposal-totals"><Summary label="Subtotal" value={f.Subtotal}/><Summary label="Discount" value={f["Event Discount"]}/><Summary label="Tax" value={f.Tax}/><Summary label="Final Total" value={f["Total Client Price"]} total/><Summary label="Deposit Required" value={f["Deposit Required"]}/><Summary label="Remaining Balance" value={f["Remaining Balance"]}/></div><h3 className="proposal-heading">Payment Schedule</h3><p>{text(f["Payment Schedule"])}</p><h3 className="proposal-heading">Terms & Conditions</h3><p>{text(f["Terms and Conditions"])}</p><div className="acceptance"><div>Client signature</div><div>Date</div></div><footer>EventArt · Professional Event Design & Coordination</footer></article></div>}
function ProposalItems({items,optional=false}:{items:Row[];optional?:boolean}){const grouped=Object.entries(items.reduce<Record<string,Row[]>>((a,i)=>{const c=text(i.fields["Custom Category"])||text(i.fields.Category)||"Services";(a[c]??=[]).push(i);return a},{}));return <div className="proposal-items">{grouped.map(([category,rows])=><section key={category}><h4>{category}</h4>{rows.map((r)=><div key={r.id}><span><b>{text(r.fields["Item / Service"])}</b><small>{text(r.fields.Description)}</small></span><em>{optional?"Optional · ":""}{cad(num(r.fields.Quantity)*num(r.fields["Unit Price"])-num(r.fields.Discount))}</em></div>)}</section>)}</div>}

function downloadCSV(items:Row[],event:Row){const heads=["Display Order",...editableFields,"Internal Cost Total","Client Line Total"] ;const rows=items.map((i)=>heads.map((h)=>`"${text(i.fields[h]).replaceAll('"','""')}"`).join(","));const blob=new Blob([[heads.join(","),...rows].join("\r\n")],{type:"text/csv"});downloadBlob(blob,`EventArt_Budget_${fileSafe(text(event.fields["Event Name"]))}.csv`)}
function fileSafe(v:string){return v.replace(/[^A-Za-z0-9_-]+/g,"_").replace(/^_+|_+$/g,"")||"Event"}
function downloadBlob(blob:Blob,name:string){const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;a.style.display="none";document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),5000)}

function downloadProposalPDF(event:Row,budget:Row,items:Row[],clientName:string){const f=budget.fields;const visible=items.filter((i)=>i.fields["Included in Proposal"]||i.fields["Optional Item"]);const pages:string[][]=[[]];let y=742;const add=(value:string,size=10,bold=false,indent=54)=>{const safe=value.normalize("NFKD").replace(/[^\x20-\x7E]/g,"");for(const line of wrap(safe,size>14?60:92)){if(y<70){pages.push([]);y=742;header()}pages.at(-1)!.push(`BT /F${bold?2:1} ${size} Tf ${indent} ${y} Td (${pdfEscape(line)}) Tj ET`);y-=size+5}};const header=()=>{add("EVENTART  |  CLIENT PROPOSAL",10,true);add(text(event.fields["Event Name"]),9,false);y-=8};header();add(text(event.fields["Event Name"]),22,true);add(`Prepared for: ${clientName||"Valued Client"}`,11);add(`Event date: ${event.fields["Ceremony Date & Time"]?new Date(text(event.fields["Ceremony Date & Time"])).toLocaleDateString("en-CA"):"TBD"}   Venue: ${text(event.fields["Venue Name"])}`,10);add(`Proposal: ${text(f["Proposal Number"])}   Issued: ${text(f["Proposal Date"])}   Expires: ${text(f["Expiration Date"])}`,9);y-=8;add(text(f.Introduction),10);y-=6;add("SCOPE OF SERVICES",13,true);add(text(f["Scope of Services"]),10);y-=8;let last="";for(const item of visible){const category=text(item.fields["Custom Category"])||text(item.fields.Category)||"SERVICES";if(category!==last){add(category.toUpperCase(),12,true);last=category}const optional=item.fields["Optional Item"]?"OPTIONAL - ":"";add(`${optional}${text(item.fields["Item / Service"])} | Qty ${num(item.fields.Quantity)} | ${cad(num(item.fields.Quantity)*num(item.fields["Unit Price"])-num(item.fields.Discount))}`,10,true);if(item.fields.Description)add(text(item.fields.Description),9,false,66);y-=4}y-=5;add(`Subtotal: ${cad(f.Subtotal)}`,10);add(`Event discount: ${cad(f["Event Discount"])}`,10);add(`Tax: ${cad(f.Tax)}`,10);add(`FINAL TOTAL: ${cad(f["Total Client Price"])}`,14,true);add(`Deposit required: ${cad(f["Deposit Required"])}`,10);add(`Remaining balance: ${cad(f["Remaining Balance"])}`,10);y-=8;add("PAYMENT SCHEDULE",12,true);add(text(f["Payment Schedule"]),9);add("TERMS AND CONDITIONS",12,true);add(text(f["Terms and Conditions"]),9);y-=18;add("Client signature: ______________________________    Date: ______________",10);const generated=new Date().toLocaleDateString("en-CA");pages.forEach((p,index)=>p.push(`BT /F1 8 Tf 54 30 Td (Generated ${pdfEscape(generated)}  |  Page ${index+1} of ${pages.length}) Tj ET`));const pdf=makePdf(pages);downloadBlob(new Blob([pdf],{type:"application/pdf"}),`EventArt_Proposal_${fileSafe(clientName)}_${fileSafe(text(event.fields["Event Name"]))}_${fileSafe(text(f["Proposal Number"]))}.pdf`)}
function wrap(value:string,max:number){const words=value.split(/\s+/);const lines:string[]=[];let line="";for(const word of words){if((line+" "+word).trim().length>max){if(line)lines.push(line);line=word}else line=(line+" "+word).trim()}if(line)lines.push(line);return lines.length?lines:[""]}
function pdfEscape(v:string){return v.replaceAll("\\","\\\\").replaceAll("(","\\(").replaceAll(")","\\)")}
function makePdf(pages:string[][]){const objects:string[]=["<< /Type /Catalog /Pages 2 0 R >>","", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>","<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>"];const pageIds:number[]=[];for(const lines of pages){const stream=lines.join("\n");const contentId=objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);const pageId=objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`);pageIds.push(pageId)}objects[1]=`<< /Type /Pages /Kids [${pageIds.map((id)=>`${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`;let out="%PDF-1.4\n";const offsets=[0];objects.forEach((o,i)=>{offsets.push(out.length);out+=`${i+1} 0 obj\n${o}\nendobj\n`});const xref=out.length;out+=`xref\n0 ${objects.length+1}\n0000000000 65535 f \n`;for(let i=1;i<offsets.length;i++)out+=`${String(offsets[i]).padStart(10,"0")} 00000 n \n`;out+=`trailer\n<< /Size ${objects.length+1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;return new TextEncoder().encode(out)}
