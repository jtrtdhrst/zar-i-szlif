#!/usr/bin/env node
// Image-based contrast diagnostic: detects a dark character disappearing into a
// dark Penpot/app scene. This is *not* a substitute for multimodal anatomy QA.
import {PNG} from 'pngjs';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
const here=path.dirname(fileURLToPath(import.meta.url));
const unpack=(file)=>PNG.sync.read(readFileSync(path.join(here,'exports',file)));
const srgb=(x)=>{const v=x/255;return v<=0.04045?v/12.92:Math.pow((v+0.055)/1.055,2.4);};
const lum=(rgb)=>0.2126*srgb(rgb[0])+0.7152*srgb(rgb[1])+0.0722*srgb(rgb[2]);
export const contrast=(a,b)=>{const p=lum(a),q=lum(b);return(Math.max(p,q)+0.05)/(Math.min(p,q)+0.05);};
export function audit(subject,background){
  if(subject.width!==background.width || subject.height!==background.height)throw new Error('DIMENSION_MISMATCH');
  const bg=[...background.data.subarray(0,3)]; // full background uses stable solid field for dark view
  let count=0,poor2=0,poor3=0,min=Infinity,sum=0;
  for(let i=0;i<subject.data.length;i+=4){
    const alpha=subject.data[i+3]/255;
    if(alpha<0.95)continue; // ignore anti-alias fringe: compare body/wing opacity
    // Measure the ACTUAL on-background theme colors at the subject mask pixels.
    // The transparent source is only the geometry mask; reading its RGB would
    // miss any dark-mode recoloring and produce a false regression result.
    const fg=[...background.data.subarray(i,i+3)];
    const ratio=contrast(fg,bg); count++;sum+=ratio;min=Math.min(min,ratio);
    if(ratio<2)poor2++;
    if(ratio<3)poor3++;
  }
  if(!count)throw new Error('EMPTY_SUBJECT');
  return {totalOpaquePixels:count,below2:poor2,below3:poor3,shareBelow2:Number((poor2/count).toFixed(4)),shareBelow3:Number((poor3/count).toFixed(4)),meanContrast:Number((sum/count).toFixed(3)),minimumContrast:Number(min.toFixed(3)),backgroundRgb:bg};
}
export function run(){
  return ['iskra-a','iskra-b','iskra-c','szlif-a','szlif-b','szlif-c','iskra-master','szlif-master','iskra-szlif-vignette'].map(id=>{
    const subject=unpack(id+'-64.png'), bg=unpack(id+'-dark-64.png');
    return {id,size:64,...audit(subject,bg)};
  });
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const result=run();console.log(JSON.stringify(result,null,2));}
  catch(err){console.error('CONTRAST_AUDIT_FAILED',String(err));process.exitCode=1;}
}
