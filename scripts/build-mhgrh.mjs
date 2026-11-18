import {readFileSync,writeFileSync} from 'node:fs';
// Parsed text of user-supplied PKGP-PRC023F-EN pp.96–119.
const lines=readFileSync('public/references/mhgrh-source.txt','utf8').split(/\r?\n/),points=[];
let table,tons,ambient,flow,rows=[];
for(const line of lines){
  const title=line.match(/Table (\d+)\.\s+Reheat temperature rise.*?[—–-]\s*([\d.]+) tons/);
  if(title){table=+title[1];tons=+title[2];}
  const a=line.match(/Ambient DB (\d+)/);if(a)ambient=+a[1];
  if(!/^\s*[\d.]+(?:\s+[\d.]+)*\s*$/.test(line))continue;
  const n=line.trim().split(/\s+/).map(Number);
  if(n.length===1&&n[0]>=900){flow=n[0];continue;}
  if(n.length===14){flow=n.shift();}
  if(n.length!==13||![60,65,70,75].includes(n[0]))continue;
  rows.push(n);
  if(rows.length===4){
    if(!flow||!ambient||!table)throw Error('Missing table coordinates');
    for(const r of rows)for(let j=0;j<3;j++)points.push([table,tons,ambient,flow,r[0],[51,55,59][j],...r.slice(1+j*4,5+j*4)]);
    rows=[];flow=undefined;
  }
}
if(rows.length||points.length!==13*3*5*4*3)throw Error(`Incomplete table extraction: ${points.length}`);
const keys=new Set(points.map(p=>p.slice(0,6).join(':')));if(keys.size!==points.length)throw Error('Duplicate points');
writeFileSync('lib/data/mhgrh.json',JSON.stringify({source:'PKGP-PRC023F-EN pp.96–119, tables 74–86',columns:['table','tons','outdoorF','cfm','enteringDryF','enteringWetF','evapMinF','evapMaxF','reheatMinF','reheatMaxF'],points}));
console.log(`Extracted ${points.length} MHGRH points across 13 tables.`);
