const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { ipcMain, WebContentsView } = require('electron');
const { WorkspaceWindowRuntime } = require('../../build/main/workspaceWindowRuntime');
const { readWebFormValue } = require('../../build/shared/webFormValues');
const { resolve } = require('node:path');

module.exports = async win => {
  win.show();
  const server = createServer((_, response) => response.end(`<!doctype html><form>
    <input id="text" value="old"><input id="password" type="password"><textarea id="notes">old notes</textarea>
    <input id="check" type="checkbox"><input id="r1" name="group" type="radio" checked><input id="r2" name="group" type="radio">
    <input id="date" type="date"><input id="number" type="number"><input id="file" type="file">
    <input id="hidden" style="display:none"><input id="readonly" readonly><fieldset disabled><input id="disabled"></fieldset>
    <select id="choice"><option value="a">A</option><option value="b">B</option><option value="bad" disabled>Bad</option></select>
    <select id="multi" multiple><option value="a">A</option><option value="b">B</option></select>
    <div id="rich" contenteditable="true">old rich text</div><button type="submit">Submit</button>
    <input id="changer"><input id="victim" value="keep me">
    <input id="reject" value="original"><input class="duplicate"><input class="duplicate"><input id="backchanger">
    </form>
    <input id="ordinary" value=""><input id="ordinary2" value=""><input id="username" autocomplete="username">
    <input id="otp" autocomplete="one-time-code"><input id="search" placeholder="Search..."><input id="search-tail"><input id="thrower">
    <script>
    window.events=[]; window.submits=0; window.model='old';
    document.querySelector('form').addEventListener('submit',e=>{e.preventDefault();submits++});
    for(const type of ['input','change']) document.addEventListener(type,e=>events.push([e.target.id,type]));
    const text=document.querySelector('#text'); const descriptor=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');
    let tracked=text.value;
    Object.defineProperty(text,'value',{get(){return descriptor.get.call(this)},set(value){tracked=value;descriptor.set.call(this,value)}});
    text.addEventListener('input',()=>{if(text.value!==tracked){model=text.value;tracked=text.value}});
    document.querySelector('#changer').addEventListener('input',()=>document.querySelector('#victim')?.remove());
    document.querySelector('#reject').addEventListener('input',e=>e.target.value='original');
    document.querySelector('#backchanger').addEventListener('input',()=>text.value='side effect');
    </script>`));
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  win.on('closed',()=>server.close());
  const views=[];
  const runtime=new WorkspaceWindowRuntime({
    id:'fill-test',window:win,openExternalUrl(){},
    store:{getWorkspaceWebAppUrl:()=>null,updateWorkspaceWebAppState(){}},
    createWebContentsView(){const view=new WebContentsView({webPreferences:{sandbox:true,preload:resolve(__dirname,'../../build/main/webappPreload.js')}});views.push(view);return view;}
  });
  ipcMain.handle('password-manager:get-credential',()=>({username:'autofilled-user',password:'autofilled-password'}));
  ipcMain.handle('webapp:autofill-consumed',()=>true);
  ipcMain.handle('fill-test:run',async()=>{
    const url=`http://127.0.0.1:${server.address().port}/`;
    const bounds={x:0,y:0,width:350,height:600};
    runtime.showWebApp({key:'target',url,bounds});
    runtime.showWebApp({key:'other',url,bounds:{...bounds,x:400}});
    runtime.setVisibleWebApps(['target','other']);
    const contents=views[0].webContents;
    for(const view of views) for(let i=0;i<100&&(!view.webContents.getURL()||view.webContents.isLoadingMainFrame());i++) await new Promise(resolve=>setTimeout(resolve,25));
    const fill=(fields,resolveBounds=async()=>bounds)=>runtime.fillWebApp('target',{expectedUrl:url,fields},resolveBounds);
    const state=()=>contents.executeJavaScript(`({text:document.querySelector('#text').value,model,events,submits})`);
    const value=selector=>contents.executeJavaScript(`(${readWebFormValue.toString()})(document.querySelector(${JSON.stringify(selector)}))`);
    for(const [selector,requested,code] of [
      ['#missing','x','ELEMENT_NOT_FOUND'],['[','x','INVALID_SELECTOR'],['.duplicate','x','ELEMENT_AMBIGUOUS'],
      ['#hidden','x','FIELD_NOT_EDITABLE'],['#readonly','x','FIELD_NOT_EDITABLE'],['#disabled','x','FIELD_NOT_EDITABLE'],
      ['#file','x','FIELD_NOT_SUPPORTED'],['#choice','missing','INVALID_FIELD_VALUE'],['#choice','bad','INVALID_FIELD_VALUE'],
      ['#date','not a date','INVALID_FIELD_VALUE'],['#number','abc','INVALID_FIELD_VALUE'],['#r1',false,'INVALID_FIELD_VALUE'],
      ['#multi',['a','a'],'INVALID_FIELD_VALUE'],['#notes',true,'INVALID_FIELD_VALUE']
    ]) {
      await assert.rejects(fill([{selector:'#text',value:'must remain unwritten'},{selector,value:requested}]),{code});
      assert.deepEqual(await state(),{text:'old',model:'old',events:[],submits:0});
    }
    await assert.rejects(fill([{selector:'#text',value:'new',expectedValue:'stale'}]),{code:'FIELD_CHANGED'});
    await assert.rejects(fill([{selector:'#text',value:'new'},{selector:'input#text',value:'again'}]),{code:'DUPLICATE_FIELD'});
    await assert.rejects(fill([{selector:'#r1',value:true},{selector:'#r2',value:true}]),{code:'CONFLICTING_RADIO_FIELDS'});
    const protectedFill=fields=>runtime.fillWebApp('target',{expectedUrl:url,fields,rejectCredentialFields:true},async()=>bounds);
    for(const selector of ['#password','#text','#username','#otp']) {
      await assert.rejects(protectedFill([{selector:'#ordinary',value:'must remain unwritten',expectedValue:''},
        {selector,value:'blocked',expectedValue:''}]),{code:'CREDENTIAL_FIELD_FORBIDDEN'});
      assert.equal(await value('#ordinary'),'');
      assert.equal((await state()).submits,0);
    }
    const guarded=await protectedFill([{selector:'#ordinary',value:'ordinary text',expectedValue:''}]);
    assert.equal(guarded.credentialPolicyApplied,true);
    assert.equal(guarded.allSucceeded,true);
    await assert.rejects(protectedFill([{selector:'#ordinary',value:'overwrite',expectedValue:''}]),{code:'FIELD_CHANGED'});
    assert.equal(await value('#ordinary'),'ordinary text');
    await contents.executeJavaScript("document.querySelector('#ordinary').addEventListener('input',()=>{document.querySelector('#ordinary2').type='password'},{once:true})");
    const credentialChange=await protectedFill([{selector:'#ordinary',value:'changed',expectedValue:'ordinary text'},
      {selector:'#ordinary2',value:'must not be filled',expectedValue:''}]);
    assert.equal(credentialChange.allSucceeded,false);
    assert.equal(credentialChange.results[1].code,'CREDENTIAL_FIELD_FORBIDDEN');
    assert.equal(await value('#ordinary2'),'');
    await contents.executeJavaScript("document.querySelector('#ordinary').addEventListener('input',event=>{event.target.type='password'},{once:true})");
    const selfChange=await protectedFill([{selector:'#ordinary',value:'self changed',expectedValue:'changed'}]);
    assert.equal(selfChange.allSucceeded,false);
    assert.equal(selfChange.results[0].code,'CREDENTIAL_FIELD_FORBIDDEN');
    const secret='private-value-never-echoed';
    await contents.executeJavaScript('events=[]');
    const fields=[
      {selector:'#text',value:'new',expectedValue:'old'},{selector:'#notes',value:'first\nsecond'},
      {selector:'#password',value:secret},{selector:'#check',value:true},{selector:'#r2',value:true},
      {selector:'#choice',value:'b'},{selector:'#multi',value:['b','a']},{selector:'#rich',value:'plain <b>text</b>'},
      {selector:'#date',value:'2026-10-03'},{selector:'#number',value:'42'}
    ];
    const result=await fill(fields);
    assert.equal(result.allSucceeded,true);assert.equal(result.filledCount,fields.length);
    assert.equal(JSON.stringify(result).includes(secret),false);
    for(const field of fields) {
      const actual=await value(field.selector);
      assert.deepEqual(Array.isArray(actual)?actual.sort():actual,Array.isArray(field.value)?field.value.sort():field.value);
    }
    const updated=await state(); assert.equal(updated.model,'new');assert.equal(updated.submits,0);
    for(const field of fields) for(const type of ['input','change']) assert.ok(updated.events.some(event=>event[0]===field.selector.slice(1)&&event[1]===type));
    assert.equal(await value('#r1'),false);
    await fill([{selector:'#check',value:false,expectedValue:true},{selector:'#text',value:'',expectedValue:'new'},{selector:'#multi',value:[]}]);
    assert.equal(await value('#check'),false);assert.equal(await value('#text'),'');assert.deepEqual(await value('#multi'),[]);
    await assert.rejects(fill([{selector:'#text',value:'stale'}],async()=>{throw Object.assign(new Error('Layout changed'),{code:'LAYOUT_CHANGED'})}),{code:'LAYOUT_CHANGED'});
    await assert.rejects(fill([{selector:'#text',value:'stale'}],async()=>{await contents.executeJavaScript('history.pushState(null,"","/changed")');return bounds}),error=>['PAGE_CHANGED','PANE_NOT_VISIBLE'].includes(error.code));
    await contents.executeJavaScript('history.replaceState(null,"","/")');
    await new Promise(resolve=>setTimeout(resolve,25));
    runtime.setVisibleWebApps(['other']);await assert.rejects(fill([{selector:'#text',value:'stale'}]),{code:'PANE_NOT_VISIBLE'});
    runtime.setVisibleWebApps(['target','other']);
    const partial=await fill([{selector:'#changer',value:'change'},{selector:'#victim',value:'must not be written'}]);
    assert.equal(partial.allSucceeded,false);assert.equal(partial.filledCount,1);assert.equal(partial.results[1].code,'FIELD_CHANGED');
    const rejected=await fill([{selector:'#reject',value:'rejected'}]);
    assert.equal(rejected.allSucceeded,false);assert.equal(rejected.results[0].code,'FIELD_VALUE_REJECTED');
    const altered=await fill([{selector:'#text',value:'requested'},{selector:'#backchanger',value:'change'}]);
    assert.equal(altered.allSucceeded,false);assert.equal(altered.results[0].code,'FIELD_VALUE_REJECTED');
    await contents.executeJavaScript(`void (document.querySelector('#text').checkVisibility=()=>{throw new Error(${JSON.stringify(secret)})})`);
    await assert.rejects(fill([{selector:'#text',value:'new'}]),error=>error.code==='PANE_FILL_FAILED'&&!error.message.includes(secret));
    await contents.executeJavaScript("delete document.querySelector('#text').checkVisibility");
    await contents.executeJavaScript("document.querySelector('#search').addEventListener('input',event=>history.replaceState(null,'',event.target.value?'/?search='+encodeURIComponent(event.target.value)+'&status=all':'/'))");
    const fillCurrent=async fields=>{
      // In-page navigation can detach a background view until loading events settle.
      for(let i=0;i<100&&(contents.isLoadingMainFrame()||!win.contentView.children.includes(views[0]));i++) await new Promise(resolve=>setTimeout(resolve,25));
      assert.ok(!contents.isLoadingMainFrame()&&win.contentView.children.includes(views[0]),'Target view is ready after navigation');
      return runtime.fillWebApp('target',{
        expectedUrl:contents.getURL(),fields,rejectCredentialFields:true,receiptVersion:2
      },async()=>bounds);
    };
    for(const [previous,next] of [['','harborcall-e2-test'],['harborcall-e2-test','']]) {
      const changed=await fillCurrent([{selector:'#search',value:next,expectedValue:previous}]);
      assert.equal(changed.receiptVersion,2);
      assert.equal(changed.attemptedCount,1);
      assert.equal(changed.appliedCount,1);
      assert.equal(changed.filledCount,0);
      assert.equal(changed.pageChangedDuringFill,true);
      assert.deepEqual(changed.results,[{selector:'#search',attempted:true,applied:true,filled:false,code:'PAGE_CHANGED'}]);
      assert.equal(await value('#search'),next);
      assert.equal(contents.getURL(),next?url+'?search=harborcall-e2-test&status=all':url);
    }
    const stopped=await fillCurrent([{selector:'#search',value:'stop',expectedValue:''},
      {selector:'#search-tail',value:'must not be written',expectedValue:''}]);
    assert.equal(stopped.attemptedCount,1);assert.equal(stopped.appliedCount,1);
    assert.deepEqual(stopped.results[1],{selector:'#search-tail',attempted:false,applied:false,filled:false,code:'NOT_ATTEMPTED'});
    assert.equal(await value('#search-tail'),'');
    await fillCurrent([{selector:'#search',value:'',expectedValue:'stop'}]);
    await contents.executeJavaScript(`window.originalInputValue=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value');
      void Object.defineProperty(HTMLInputElement.prototype,'value',{...originalInputValue,set(value){originalInputValue.set.call(this,value);if(this.id==='thrower'&&this.isConnected){history.replaceState(null,'','/?setter=uncertain');throw new Error('fixture setter uncertainty')}}})`);
    const uncertain=await fillCurrent([{selector:'#thrower',value:'written before exception',expectedValue:''}]);
    await contents.executeJavaScript("void Object.defineProperty(HTMLInputElement.prototype,'value',originalInputValue)");
    assert.equal(uncertain.attemptedCount,1);assert.equal(uncertain.appliedCount,0);
    assert.equal(uncertain.pageChangedDuringFill,true);
    assert.deepEqual(uncertain.results,[{selector:'#thrower',attempted:true,applied:null,filled:false,code:'FIELD_FILL_FAILED'}]);
    assert.equal(await value('#thrower'),'written before exception');
    await contents.executeJavaScript("void history.replaceState(null,'','/')");
    assert.equal((await state()).submits,0);
    runtime.updateWebAppAutofill('target',true);
    for(let i=0;i<100&&(await value('#text'))!=='autofilled-user';i++) await new Promise(resolve=>setTimeout(resolve,25));
    assert.equal(await value('#text'),'autofilled-user');assert.equal(await value('#password'),'autofilled-password');
    assert.equal((await state()).submits,0);
    assert.deepEqual(await views[1].webContents.executeJavaScript('({model,events,submits})'),{model:'old',events:[],submits:0});
    server.close();
  });
};
