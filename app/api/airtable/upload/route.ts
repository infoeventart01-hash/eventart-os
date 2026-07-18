import { NextRequest,NextResponse } from "next/server";
import {requireIdentity} from "../../../../lib/auth";

const BASE_ID=(process.env.AIRTABLE_BASE_ID||"").trim();
const TOKEN=(process.env.AIRTABLE_TOKEN||"").trim();
const allowedUploads:Record<string,Set<string>>={
 Inventory:new Set(["Photo"]),
 "Design Board":new Set(["Design File","Preview Image"]),
 Events:new Set(["Seating QR Code"]),
 "Service Catalog":new Set(["Image"]),
};
const allowedExtensions=new Set(["jpg","jpeg","png","webp","pdf","docx","pptx","xlsx","skp"]);
const imageExtensions=new Set(["jpg","jpeg","png","webp"]);
const maxBytes=5*1024*1024;
const maxRequestBytes=6*1024*1024;
function base64(bytes:Uint8Array){let out="";const size=0x8000;for(let i=0;i<bytes.length;i+=size)out+=String.fromCharCode(...bytes.subarray(i,i+size));return btoa(out)}
function safeError(data:unknown,status:number){const e=(data as {error?:{type?:unknown;message?:unknown}})?.error;return {type:typeof e?.type==="string"?e.type:`HTTP_${status}`,message:typeof e?.message==="string"?e.message:"Airtable could not accept this attachment"}}
async function responsePayload(response:Response){const type=response.headers.get("content-type")||"";if(type.includes("application/json"))return response.json().catch(()=>({}));const message=(await response.text().catch(()=>"")).trim();return {error:{type:`HTTP_${response.status}`,message:message&&message.length<240?message:"Airtable could not accept this attachment"}}}

export async function POST(request:NextRequest){
 const auth=requireIdentity(request,["owner","team"]);if(auth.error)return auth.error;const identity=auth.identity!;
 if(!TOKEN||!/^app[A-Za-z0-9]{14}$/.test(BASE_ID))return NextResponse.json({error:"Airtable upload is not configured"},{status:400});
 try{
  const contentLength=Number(request.headers.get("content-length")||0);if(contentLength>maxRequestBytes)return NextResponse.json({error:"The server could not accept this upload because the request exceeds 6 MB"},{status:413});
  const form=await request.formData();const table=String(form.get("table")||"");const record=String(form.get("record")||"");const attachmentField=String(form.get("attachmentField")||"");const files=form.getAll("files").filter((v):v is File=>v instanceof File&&v.size>0);
  if(!table||!record||!attachmentField||!files.length)return NextResponse.json({error:"Table, record, attachment field and files are required"},{status:400});
  if(!allowedUploads[table]?.has(attachmentField))return NextResponse.json({error:"This attachment field is not approved for uploads"},{status:400});
  if(identity.role==="team"&&table!=="Design Board")return NextResponse.json({error:"Team members can upload only assigned Design Studio files."},{status:403});
  if(!/^rec[A-Za-z0-9]{14}$/.test(record))return NextResponse.json({error:"A valid Airtable record is required before files can be uploaded"},{status:400});
  if(identity.role==="team"){const verify=await fetch(`https://api.airtable.com/v0/${encodeURIComponent(BASE_ID)}/${encodeURIComponent(table)}/${encodeURIComponent(record)}`,{headers:{Authorization:`Bearer ${TOKEN}`},cache:"no-store"});const row=await verify.json() as {fields?:Record<string,unknown>};const events=Array.isArray(row.fields?.Event)?row.fields!.Event as string[]:[];if(!verify.ok||!events.some(id=>identity.eventRecordIds.includes(id)))return NextResponse.json({error:"This design is not assigned to your account."},{status:403})}
  const results=[];
  for(const file of files){const extension=file.name.split(".").pop()?.toLowerCase()||"";const imagesOnly=["Preview Image","Photo","Image","Seating QR Code"].includes(attachmentField);if(!allowedExtensions.has(extension)||(imagesOnly&&!imageExtensions.has(extension)))return NextResponse.json({error:imagesOnly?"This image must be JPG, JPEG, PNG or WEBP":"The selected file type is not supported"},{status:415});if(file.size>maxBytes)return NextResponse.json({error:"This file exceeds the 5 MB limit"},{status:413});
   const response=await fetch(`https://content.airtable.com/v0/${encodeURIComponent(BASE_ID)}/${encodeURIComponent(record)}/${encodeURIComponent(attachmentField)}/uploadAttachment`,{method:"POST",headers:{Authorization:`Bearer ${TOKEN}`,"Content-Type":"application/json"},body:JSON.stringify({contentType:file.type||"application/octet-stream",filename:file.name,file:base64(new Uint8Array(await file.arrayBuffer()))})});
   const data:unknown=await responsePayload(response);if(!response.ok){const error=safeError(data,response.status);console.error("Airtable attachment error",error);return NextResponse.json({error},{status:response.status})}results.push(data)
  }
  return NextResponse.json({uploaded:files.length,records:results});
 }catch{return NextResponse.json({error:"Unable to upload attachments securely"},{status:502})}
}
