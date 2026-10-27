// Minimal editable test document following Aseprite's published file format.
import {chromium} from 'playwright';import {readFile,writeFile} from 'node:fs/promises';import {deflateSync} from 'node:zlib';
const u16=n=>{const b=Buffer.alloc(2);b.writeUInt16LE(n);return b;};
const chunk=(type,data)=>{const b=Buffer.alloc(6);b.writeUInt32LE(data.length+6);b.writeUInt16LE(type,4);return Buffer.concat([b,data]);};
const string=text=>Buffer.concat([u16(Buffer.byteLength(text)),Buffer.from(text)]);
const browser=await chromium.launch({channel:'msedge',headless:true});
try{const page=await browser.newPage();await page.setContent(await readFile('assets/actors.svg','utf8'));
const allFrames=await page.evaluate(async()=>{const svg=new XMLSerializer().serializeToString(document.querySelector('svg'));const image=new Image();image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);await image.decode();const canvas=document.createElement('canvas');canvas.width=192;canvas.height=96;const context=canvas.getContext('2d');context.drawImage(image,0,0);return Array.from({length:2},(_,row)=>Array.from({length:6},(_,frame)=>Array.from(context.getImageData(frame*32,row*48,32,48).data)));});
for(let variant=0;variant<2;variant++){
 const frames=[];for(let frame=0;frame<6;frame++){const chunks=[];
  if(frame===0){const layer=Buffer.alloc(16);layer.writeUInt16LE(3);layer[12]=255;chunks.push(chunk(0x2004,Buffer.concat([layer,string('V2-inspired test base')])));
   const tags=[['idle',0,1],['walk',2,3],['handoff',4,5]].map(([name,from,to])=>{const data=Buffer.alloc(17);data.writeUInt16LE(from);data.writeUInt16LE(to,2);return Buffer.concat([data,string(name)]);});chunks.push(chunk(0x2018,Buffer.concat([u16(3),Buffer.alloc(8),...tags])));}
  const cel=Buffer.alloc(20);cel[6]=255;cel.writeUInt16LE(2,7);cel.writeUInt16LE(32,16);cel.writeUInt16LE(48,18);chunks.push(chunk(0x2005,Buffer.concat([cel,deflateSync(Buffer.from(allFrames[variant][frame]))])));
  const data=Buffer.concat(chunks),header=Buffer.alloc(16);header.writeUInt32LE(data.length+16);header.writeUInt16LE(0xf1fa,4);header.writeUInt16LE(chunks.length,6);header.writeUInt16LE([600,200,140,140,180,300][frame],8);frames.push(header,data);
 }
 const contents=Buffer.concat(frames),header=Buffer.alloc(128);header.writeUInt32LE(contents.length+128);header.writeUInt16LE(0xa5e0,4);header.writeUInt16LE(6,6);header.writeUInt16LE(32,8);header.writeUInt16LE(48,10);header.writeUInt16LE(32,12);header.writeUInt32LE(1,14);header.writeUInt16LE(100,18);header[34]=1;header[35]=1;await writeFile(`assets/worker-${variant?'b':'a'}.aseprite`,Buffer.concat([header,contents]));
}
console.log('Authored two editable 6-frame test documents with tags and variable durations.');
}finally{await browser.close();}
