import {readFile} from 'node:fs/promises';
import {analyzeTiming,loadTiming} from '../dist/timing.js';
const file=process.argv[2];
if(!file){console.error('Usage: node scripts/analyze-timing.mjs <exported-timing.json>');process.exit(1);}
const data=JSON.parse(await readFile(file,'utf8'));
const runs=loadTiming(data);
if(!runs.length){console.error('No valid timing runs found.');process.exit(1);}
console.log(JSON.stringify(analyzeTiming(runs),null,2));
