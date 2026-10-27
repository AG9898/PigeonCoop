export const groundRects=[];
const rect=(x,y,w,h,color)=>({x,y,w,h,color});
const ground=(...a)=>groundRects.push(rect(...a));
ground(0,0,304,224,0xdbe2c6);
for(let y=12;y<212;y+=8)for(let x=8;x<300;x+=8){const seed=(x*17+y*31)%19;ground(x,y,8,8,[0xc1d39a,0xbace91,0xc7d8a1,0xc1d39a][seed%4]);if(seed%5===0)ground(x+2,y+3,2,1,0xa4bc80);}
for(let x=44;x<279;x+=8)for(let y=126;y<154;y+=8)ground(x,y,8,8,(x+y)%3?0xd8c18f:0xdfcb9e);
for(let x=104;x<240;x+=8)for(let y=77;y<98;y+=8)ground(x,y,8,8,0xddc997);
for(let y=93;y<140;y+=8){ground(108,y,16,8,0xddc997);ground(219,y,16,8,0xddc997);}
const tree=[[-18,-7,37,11,0x9eb77b],[-4,-31,9,33,0x71543c],[-3,-30,3,29,0x997548],[-22,-57,43,30,0x3f6649],[-28,-50,54,18,0x3f6649],[-22,-58,39,17,0x557b50],[-15,-65,25,23,0x638b53],[-24,-49,13,12,0x7f9c5e],[-7,-61,14,8,0x95ae67],[13,-47,9,11,0x4a714a]].map(a=>rect(...a));
const plant=[[-7,-10,14,10,0xa9744c],[-9,-13,18,4,0xcc9561],[-2,-29,4,17,0x598052],[-10,-25,9,7,0x7c9d57],[1,-32,8,9,0x8ca85e],[1,-22,10,6,0x658a4b]].map(a=>rect(...a));
const rock=[[-8,-3,17,5,0xa9ba86],[-9,-10,16,9,0x88998b],[-6,-13,10,6,0xabb8a4]].map(a=>rect(...a));
export const props=[[170,150,tree],[36,87,tree],[275,68,tree],[274,158,plant],[251,72,plant],[49,164,rock],[92,190,rock],[209,191,plant],[18,142,plant]].map(([x,y,rects])=>({x,y,rects}));
export function ambientRects(time,reduced,interrupted){const motion=reduced||interrupted?0:Math.floor(time/420)%2;const rects=[[20,182,43,18,0x7faeb1],[23,185+motion,16,2,0xb2d0be],[43,192-motion,14,2,0xb2d0be]];for(let i=0;i<5;i++)rects.push([76+i*5+motion,44+(i%2)*3,2,5,0x88a65f]);return rects.map(a=>rect(...a));}
