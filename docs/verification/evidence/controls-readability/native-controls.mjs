import { chromium } from '/Users/caoyujie/codes/camellia-golden-week/node_modules/playwright/index.mjs';
import {writeFile} from 'node:fs/promises';
const browser=await chromium.launch({channel:'chrome',headless:true});
const page=await browser.newPage();
const result={browser:browser.version(),steps:[]};
try {
 await page.setContent('<select aria-label="画质"><option value="standard">标准画质</option><option value="low">低画质</option></select><textarea readonly>abcdef</textarea>');
 await page.keyboard.press('Tab');
 for(const key of ['ArrowDown','Enter','Space','ArrowDown','Enter','Space','ArrowUp','Enter']){
  await page.keyboard.press(key);await page.waitForTimeout(50);result.steps.push({key,...await page.evaluate(()=>({tag:document.activeElement.tagName,value:document.querySelector('select').value}))});
 }
 await page.keyboard.press('Tab');
 await page.keyboard.press('Meta+a');
 const selection=()=>page.locator('textarea').evaluate(e=>({start:e.selectionStart,end:e.selectionEnd}));
 result.textareaBefore=await selection();
 await page.keyboard.press('ArrowRight');
 result.textareaAfter=await selection();
} finally {await writeFile('/Users/caoyujie/codes/camellia-golden-week/test-results/controls-readability/native-controls.json',JSON.stringify(result,null,2)+'\n');await browser.close();console.log(JSON.stringify(result,null,2));}
