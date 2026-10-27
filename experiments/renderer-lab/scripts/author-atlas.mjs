// Editable code-native pixel source. Fresh test art inspired by V2's clothing;
// not an ImageGen strip and not claimed as production-quality character art.
import { writeFile } from 'node:fs/promises';
const rect=(x,y,w,h,c)=>`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${c}"/>`;
let content='';
for(let variant=0;variant<2;variant++) for(let frame=0;frame<6;frame++) {
  const ox=frame*32,oy=variant*48;
  const r=(x,y,w,h,c)=>rect(ox+x,oy+y,w,h,c);
  const ink='#302735',hair=variant?'#393447':'#75492f',hi=variant?'#51465a':'#ab703f',coat=variant?'#477451':'#285b68',light=variant?'#729965':'#49828c';
  const stride=frame===2?-2:frame===3?2:0;
  content+=r(7,41,19,3,'#434135');
  content+=r(10+stride,34,6,9,ink)+r(19-stride,34,6,9,ink);
  content+=r(9+stride,39,7,4,'#a16b35')+r(19-stride,39,7,4,'#a16b35');
  content+=r(8,23,19,13,ink)+r(9,24,17,10,coat)+r(11,24,4,8,light);
  content+=r(17,24,5,7,'#eee2bc')+r(18,25,3,5,'#c5b88d');
  content+=r(6,25,5,10,ink)+r(7,25,4,6,light)+r(7,31,4,5,'#efb67a');
  if(frame>=4) {const handY=frame===4?25:27;content+=r(25,handY,6,5,ink)+r(26,handY,6,4,'#f2bc82');if(frame===4)content+=r(29,handY,3,3,'#f4e3ae');}
  else content+=r(25,25,5,10,ink)+r(25,25,4,6,light)+r(25,31,4,5,'#efb67a');
  content+=r(8,12,18,14,ink)+r(9,13,17,12,'#f1bc83')+r(8,18,3,6,'#e7a26c');
  content+=r(7,9,20,9,hair)+r(5,11,6,9,hair)+r(10,5,8,8,hair)+r(18,7,6,7,hair)+r(24,11,5,5,hair);
  content+=r(8,9,6,4,hi)+r(14,7,3,6,hi)+r(18,11,6,3,hi)+r(10,13,8,5,hair)+r(9,17,3,4,hair);
  if(variant) content+=r(6,5,8,8,ink)+r(7,5,6,6,hi);
  if(frame===1) content+=r(17,19,2,1,ink)+r(23,18,2,1,ink);
  else content+=r(17,18,2,4,ink)+r(23,17,2,4,ink);
  content+=r(13,24,3,5,'#b77b36')+r(11,28,3,5,'#b77b36')+r(8,32,9,7,ink)+r(9,32,7,6,'#b77b36')+r(11,33,3,2,'#dfba6b');
}
await writeFile('assets/actors.svg',`<svg xmlns="http://www.w3.org/2000/svg" width="192" height="96" viewBox="0 0 192 96" shape-rendering="crispEdges">${content}</svg>`);
await writeFile('assets/atlas.json',JSON.stringify({width:192,height:96,frame_width:32,frame_height:48,foot_anchor:[16,44],clips:{idle:[0,1],walk:[2,3],interact:[4,5]},source:'Hand-authored SVG test art inspired by V2; not production art'},null,2));
console.log('Authored 12 registered frames; identical 32x48 bounds and [16,44] foot anchor.');
