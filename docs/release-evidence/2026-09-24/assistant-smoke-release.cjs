process.env.TEMP ||= require('node:os').tmpdir();
require('node:fs').mkdirSync(require('node:path').join(process.env.TEMP, 'decisionjudge-browser'), { recursive: true });
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs/promises');
(async()=>{
 const browser=await chromium.launch({channel:process.env.BROWSER_CHANNEL || 'msedge',headless:true});
 const context=await browser.newContext({viewport:{width:1440,height:1000},locale:'zh-CN',timezoneId:'Asia/Shanghai',acceptDownloads:true});
 const page=await context.newPage(); const errors=[];page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000);
 const btn=name=>page.getByRole('button',{name,exact:true});const label=name=>page.getByLabel(name,{exact:true});
 const proposal={title:'问答生成的职业选择',objective:'提高成长机会并保留生活空间',options:[{name:'新机会',description:'确认职责',isStatusQuo:false},{name:'留任',description:'继续积累',isStatusQuo:true}],criteria:[{name:'成长空间',description:'用户更在意成长；权重待确认',weight:60,lowAnchor:'长期停滞',highAnchor:'持续成长'},{name:'生活空间',description:'保留休息时间',weight:40,lowAnchor:'经常加班',highAnchor:'时间可控'}],constraints:[{label:'收入足以覆盖日常开支',description:'核实书面收入'}]};
 let mode='question';const requests=[];
 await page.route('https://assistant.test/v1/chat/completions',async route=>{
  if(route.request().method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'*','access-control-allow-headers':'content-type,authorization','access-control-allow-methods':'POST,OPTIONS'}});
  const body=route.request().postDataJSON();requests.push(body);
  assert.equal(body.model,'test-model');assert.equal(body.stream,false);
  if(mode==='error')return route.fulfill({status:401,headers:{'access-control-allow-origin':'*'},body:'secret-must-not-display'});
  if(mode==='network')return route.abort('failed');
  if(mode==='slow'){await new Promise(r=>setTimeout(r,1800));}
  const content=mode==='invalid'?'{"message":"错误草稿","proposal":{}}':JSON.stringify({message:mode==='question'?'你更在意成长还是可控的生活节奏？':'根据你的回答，先看这份可修改的权衡草稿。',proposal:mode==='question'?null:proposal});
  await route.fulfill({status:200,contentType:'application/json',headers:{'access-control-allow-origin':'*'},body:JSON.stringify({choices:[{message:{content}}]})});
 });
 const fit=async name=>{const dimensions=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert(dimensions.scroll<=dimensions.width,name+JSON.stringify(dimensions));};
 try{
 await page.goto(process.env.RELEASE_URL || 'http://127.0.0.1:4173/');await page.getByRole('button',{name:/新建一项决策/}).click();await page.getByRole('button',{name:/换工作 比较留任/}).click();
 assert.equal(await btn('普通模式').getAttribute('aria-pressed'),'true');
 await page.getByRole('button',{name:/设置权重/}).click();assert.equal(await page.locator('input[type=range]').count(),0);assert.equal(await page.getByText('摆幅赋权',{exact:false}).count(),0);
 await label('职业发展备注').fill('我最重视成长');await label('职业发展权重百分比').fill('50');await btn('按比例调整到 100%').click();
 await btn('专业模式').click();assert((await page.locator('input[type=range]').count())>0);assert.equal(await label('职业发展说明').inputValue(),'我最重视成长');await btn('普通模式').click();
 await page.getByRole('button',{name:/逐项评分/}).click();assert.equal(await page.locator('.simple-comparison select').count(),0);await label('接受新机会在职业发展上的评分').fill('8');await label('接受新机会在职业发展上的备注').fill('来自访谈的判断');
 await btn('专业模式').click();assert.equal(await page.locator('.dj-score-option textarea').first().inputValue(),'来自访谈的判断');await page.getByLabel('来源（可选）',{exact:true}).first().fill('内部访谈记录不应发送');await btn('普通模式').click();
 await page.setViewportSize({width:390,height:844});await fit('simple score mobile');await page.screenshot({path:path.join(process.env.TEMP,'decisionjudge-browser/simple-scores.png'),fullPage:true});
 await btn('问答梳理 · 帮我开始').click();await label('API 地址').fill('https://assistant.test/v1');await label('模型名称').fill('test-model');await label('API 密钥').fill('session-test-key');await label('提示词预设').selectOption('career');await btn('保存连接与提示词').click();
 assert(!(await page.evaluate(()=>JSON.stringify(localStorage))).includes('session-test-key'));
 await label('你的回答').fill('我在犹豫换工作还是留任，更看重成长。');await btn('发送回答').click();await page.getByText('你更在意成长还是可控的生活节奏？',{exact:true}).waitFor();
 assert(!JSON.stringify(requests).includes('内部访谈记录不应发送'));assert(!JSON.stringify(requests).includes('session-test-key'));assert.equal(await page.locator('.editor-title-small').innerText(),'换工作');
 await page.setViewportSize({width:320,height:844});await fit('assistant narrow');await page.setViewportSize({width:390,height:844});
 mode='invalid';await label('你的回答').fill('先整理一版吧');await btn('发送回答').click();await page.getByText(/助手返回的草稿结构不完整/).waitFor();assert.equal(await label('你的回答').inputValue(),'先整理一版吧');assert.equal(await page.locator('.assistant-proposal').count(),0);
 mode='error';await btn('发送回答').click();await page.getByText(/API 请求失败（401）/).waitFor();assert(!(await page.locator('body').innerText()).includes('secret-must-not-display'));
 mode='proposal';await btn('发送回答').click();await page.getByRole('region',{name:'首轮设计预览'}).waitFor();assert(await btn('应用草稿，检查权重 →').isDisabled());assert.equal(requests.at(-1).messages.filter(m=>m.role==='assistant').length,1);
 await btn('收起助手').click();await label('接受新机会在职业发展上的备注').fill('此时又修改了比较');await btn('问答梳理 · 帮我开始').click();await page.getByText('比较内容已修改。请重新开始问答，让助手使用最新结构。',{exact:true}).waitFor();assert(await btn('应用草稿，检查权重 →').isDisabled());
 await btn('重新开始问答').click();mode='slow';await label('你的回答').fill('用最新记录设计');await btn('发送回答').click();await btn('停止请求').click();await page.getByText(/已停止本次请求/).waitFor();assert.equal(await label('你的回答').inputValue(),'用最新记录设计');
 mode='proposal';await btn('发送回答').click();await page.getByRole('region',{name:'首轮设计预览'}).waitFor();await page.screenshot({path:path.join(process.env.TEMP,'decisionjudge-browser/assistant-preview.png'),fullPage:true});await fit('proposal mobile');
 await page.getByRole('checkbox',{name:/用这份草稿替换当前目标/}).check();await btn('应用草稿，检查权重 →').click();await page.getByRole('region',{name:'简洁权重设置'}).waitFor();assert.equal(await label('成长空间权重百分比').inputValue(),'60');assert.equal(await page.locator('.editor-title-small').innerText(),proposal.title);
 await page.getByRole('button',{name:/逐项评分/}).click();assert.equal(await page.locator('.simple-comparison input[type=number]').count(),4);for(const input of await page.locator('.simple-comparison input[type=number]').all())assert.equal(await input.inputValue(),'');
 await btn('← 全部决策').click();await page.getByRole('button',{name:/问答生成的职业选择/}).click();await page.getByRole('button',{name:/设置权重/}).click();assert.equal(await label('成长空间权重百分比').inputValue(),'60');assert.equal(await btn('普通模式').getAttribute('aria-pressed'),'true');
 await btn('问答梳理 · 帮我开始').click();await btn('API 与提示词设置').click();assert.equal(await label('API 密钥').inputValue(),'session-test-key');await btn('收起助手').click();await btn('← 全部决策').click();
 const downloadPromise=page.waitForEvent('download');await btn('导出').click();const download=await downloadPromise;const backupPath=path.join(process.env.TEMP,'decisionjudge-browser/assistant-backup.json');await download.saveAs(backupPath);const backup=await fs.readFile(backupPath,'utf8');assert(!backup.includes('session-test-key'));assert(!backup.includes('assistant.test'));assert.equal(JSON.parse(backup).decisions[0].constraints[0].evaluations.constructor,Object);
 await page.reload();await page.getByRole('button',{name:/问答生成的职业选择/}).click();await btn('问答梳理 · 帮我开始').click();await btn('API 与提示词设置').click();assert.equal(await label('API 密钥').inputValue(),'');assert.equal(await label('模型名称').inputValue(),'test-model');assert.equal(await label('提示词预设').inputValue(),'career');
 assert.deepEqual(errors,[]);console.log('PASS: simple/pro data retention, 320/390px, multi-turn API request, settings/prompt persistence, malformed/401 errors, cancel/retry, stale proposal guard, preview/apply, empty scores, reload/backup, memory-only key, no runtime errors.');
 }catch(e){await page.screenshot({path:path.join(process.env.TEMP,'decisionjudge-browser/assistant-failure.png'),fullPage:true});console.error((await page.locator('body').innerText()).slice(-4500));throw e;}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
