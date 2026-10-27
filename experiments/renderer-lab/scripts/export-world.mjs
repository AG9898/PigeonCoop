import {writeFile} from 'node:fs/promises';import {groundRects,props} from '../web/world-data.mjs';
await writeFile('assets/scene.json',JSON.stringify({width:304,height:224,ground:groundRects,props}));
console.log('Exported identical geometry for native and browser candidates.');
