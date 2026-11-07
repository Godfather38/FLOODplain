import {readFileSync,writeFileSync} from 'node:fs';
const content=readFileSync(new URL('../public/sms-policy-content.html',import.meta.url),'utf8');
for(const name of ['privacy','terms']) writeFileSync(new URL(`../public/${name}.html`,import.meta.url),`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>FLOODplain ${name==='privacy'?'Privacy Policy':'Terms of Service'}</title><link rel="stylesheet" href="policy.css?v=dev"></head><body class="policy-document"><main class="policy-copy">${content}</main></body></html>\n`);
const url=new URL('../public/index.html',import.meta.url);let index=readFileSync(url,'utf8');
const block=`<!-- SMS POLICY START -->\n<link rel="stylesheet" href="policy.css?v=dev">\n<aside id="legacy-policy" class="policy-copy" hidden>${content.replaceAll('href="#privacy"','href="privacy.html#privacy"').replaceAll('href="#terms"','href="terms.html#terms"')}</aside>\n<script src="policy-route.js?v=dev"></script>\n<!-- SMS POLICY END -->`;
index=/<!-- SMS POLICY START -->/.test(index)?index.replace(/<!-- SMS POLICY START -->[\s\S]*?<!-- SMS POLICY END -->/,block):index.replace('<body>','<body>\n'+block);
writeFileSync(url,index);
