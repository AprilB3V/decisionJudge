process.env.TEMP ||= require('node:os').tmpdir();
require('node:fs').mkdirSync(require('node:path').join(process.env.TEMP, 'decisionjudge-browser'), { recursive: true });
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
(async()=>{
const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL || 'msedge',headless:true});const context=await browser.newContext({viewport:{width:1280,height:900},timezoneId:'Asia/Shanghai'});const page=await context.newPage();page.setDefaultTimeout(5000);
const out={};let dialogs=0;let nextDialogAction='dismiss';page.on('dialog',async dialog=>{dialogs++;if(nextDialogAction==='accept')await dialog.accept();else await dialog.dismiss();});
try{
 await page.goto(process.env.RELEASE_URL || 'http://127.0.0.1:4173/');
 await page.getByRole('button',{name:/新建一项决策/}).click();await page.getByRole('button',{name:/换工作 比较留任/}).click();
 await page.getByRole('button',{name:/逐项评分/}).click();for(const input of await page.locator('.simple-comparison input[type=number]').all())await input.fill('7');
 await page.getByRole('button',{name:/查看结果/}).click();await page.getByRole('button',{name:'确认并保存快照 →',exact:true}).click();await page.getByText('决策快照已保存。',{exact:true}).waitFor();
 await page.getByRole('button',{name:'← 全部决策',exact:true}).click();
 const counts=()=>page.evaluate(async()=>{const db=await new Promise((resolve,reject)=>{const r=indexedDB.open('decisionjudge-local');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});const read=name=>new Promise((resolve,reject)=>{const r=db.transaction(name).objectStore(name).count();r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});const result={decisions:await read('decisions'),snapshots:await read('snapshots')};db.close();return result;});
 const before=await counts();await page.getByRole('button',{name:'删除',exact:true}).click();await page.getByRole('button',{name:'删除',exact:true}).waitFor();const afterCancel=await counts();assert.deepEqual(afterCancel,before);nextDialogAction='accept';await page.getByRole('button',{name:'删除',exact:true}).click();await page.getByText('还没有保存的决策',{exact:true}).waitFor();const after=await counts();assert.equal(before.snapshots,1);assert.equal(after.snapshots,0);assert.equal(dialogs,2);out.delete={before,afterCancel,after,confirmationDialogs:dialogs,undoButtonCount:await page.getByRole('button',{name:/撤销|恢复/}).count()};
 await page.getByRole('button',{name:/新建一项决策/}).click();await page.getByRole('button',{name:/换工作 比较留任/}).click();await page.getByRole('button',{name:'← 全部决策',exact:true}).click();
 const other=await context.newPage();await other.goto(process.env.RELEASE_URL || 'http://127.0.0.1:4173/');await page.locator('.decision-open').click();await other.locator('.decision-open').click();
 await page.getByLabel('给这项决策起个名字',{exact:true}).fill('先保存的页面');await page.getByRole('status').filter({hasText:'已保存在本机'}).waitFor();
 await other.getByLabel('给这项决策起个名字',{exact:true}).fill('另一页尚未保存的输入');await other.getByRole('alert').filter({hasText:'其他页面已修改'}).waitFor();
 const download=other.waitForEvent('download');await other.getByRole('button',{name:'导出当前草稿',exact:true}).click();await download;
 await other.getByRole('button',{name:'← 全部决策',exact:true}).click();await other.getByRole('alert').filter({hasText:'其他页面已修改'}).waitFor();
 out.conflict={stillInEditor:await other.getByLabel('给这项决策起个名字',{exact:true}).isVisible(),draftRetained:await other.getByLabel('给这项决策起个名字',{exact:true}).inputValue(),recoveryButtons:await other.locator('.save-error-box button').allTextContents()};assert(out.conflict.stillInEditor);await other.close();
 await page.getByRole('button',{name:'专业模式',exact:true}).click();await page.getByRole('button',{name:/设置权重/}).click();await page.getByLabel('1 分代表',{exact:true}).first().fill('一年内没有新增职责');await page.getByLabel('10 分代表',{exact:true}).first().fill('一年内独立负责团队');
 await page.getByRole('button',{name:'普通模式',exact:true}).click();await page.getByRole('button',{name:/逐项评分/}).click();const scoring=await page.locator('.simple-comparison').innerText();out.anchors={customScaleVisible:scoring.includes('一年内独立负责团队'),genericScaleVisible:scoring.includes('10 分非常符合')};
 await fs.writeFile(path.join(process.env.TEMP,'decisionjudge-browser/release-probes.json'),JSON.stringify(out,null,2));console.log(JSON.stringify(out,null,2));
}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
