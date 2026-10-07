import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
import { request as webRequest, clearSession, session } from '../src/api.js'
const require=createRequire(import.meta.url)

test('web writes use CSRF and resource versions; failed writes are not retried',async()=>{
  const original=globalThis.fetch,calls=[]
  clearSession()
  globalThis.fetch=async(url,options)=>{calls.push({url,options});if(url.endsWith('/csrf'))return new Response(JSON.stringify({code:1,data:{csrf_token:'test-csrf'}}));return new Response(JSON.stringify({code:'RESOURCE_CHANGED',msg:'内容已更新'}),{status:412})}
  try {
    await assert.rejects(webRequest('/posts/1',{method:'PUT',data:{item_name:'draft'},etag:'"post-1-v2"'}),e=>e.status===412)
    assert.equal(calls.length,2)
    assert.equal(calls[1].options.headers['X-CSRF-Token'],'test-csrf')
    assert.equal(calls[1].options.headers['If-Match'],'"post-1-v2"')
    assert.equal(calls[1].options.credentials,'same-origin')
    assert.equal(JSON.parse(calls[1].options.body).item_name,'draft')
  }finally{globalThis.fetch=original;clearSession();session.notice=''}
})

test('native requests use bearer tokens and clear revoked sessions',async()=>{
  const storage=new Map([['token','test-native-token'],['user',{id:'1'}]]),app={globalData:{user:{id:'1'}}},calls=[]
  globalThis.getApp=()=>app;globalThis.getCurrentPages=()=>[{route:'pages/home/home'}]
  globalThis.wx={getStorageSync:k=>storage.get(k),removeStorageSync:k=>storage.delete(k),getFileSystemManager:()=>({unlink(){}}),reLaunch:o=>calls.push(o),request:o=>{calls.push(o);o.success({statusCode:401,data:{code:'TOKEN_REVOKED',msg:'请重新登录'}})}}
  try {
    const native=require('../../miniprogram/utils/api.js')
    await assert.rejects(native.request('/posts'),e=>e.code==='TOKEN_REVOKED')
    assert.equal(calls[0].header.Authorization,'Bearer test-native-token')
    assert.equal(calls[0].header.Cookie,undefined)
    assert.equal(storage.has('token'),false)
    assert.equal(app.globalData.user,null)
    assert.equal(app.globalData.preserveDrafts,true)
    assert.equal(calls[1].url,'/pages/login/login')
  }finally{delete globalThis.wx;delete globalThis.getApp;delete globalThis.getCurrentPages}
})


test('native interrupted publication restores inputs and reuses its idempotency key',async()=>{
  const domain=require('../../miniprogram/utils/domain.js'),app={globalData:{user:{id:'3'},drafts:{},preserveDrafts:false}},writes=[]
  let revoked=true
  const api={loadImages(){},guard:()=>true,request:async(path,options)=>{if(path.endsWith('post-quota'))return {remaining:1,limit:3};writes.push(options);if(revoked){app.globalData.preserveDrafts=true;throw Object.assign(new Error('请重新登录'),{code:'TOKEN_REVOKED',status:401})}return {id:'test-post'}}}
  const module={exports:{}}
  vm.runInNewContext(readFileSync(new URL('../../miniprogram/utils/postForm.js',import.meta.url),'utf8'),{module,require:name=>name==='./api'?api:domain,getApp:()=>app,wx:{disableAlertBeforeUnload(){},enableAlertBeforeUnload(){}}})
  const makePage=()=>{const page=module.exports();page.setData=patch=>Object.assign(page.data,patch);page.onLoad({});return page}
  const first=makePage();await first.load()
  Object.assign(first.data.form,{post_type:'lost',campus:'xiasha',item_name:'待恢复耳机',location:'图书馆',description:'恢复完整输入，防止重复创建',contact_methods:[{type:'wechat',value:'demo'}]})
  await first.submit();first.onUnload()
  app.globalData.preserveDrafts=false;revoked=false
  const restored=makePage();await restored.load()
  assert.equal(restored.data.form.item_name,'待恢复耳机')
  assert.equal(restored.data.form.contact_methods[0].value,'demo')
  await restored.submit()
  assert.equal(writes.length,2)
  assert.match(writes[0].key,/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  assert.equal(writes[1].key,writes[0].key)
  assert.equal(restored.data.success.id,'test-post')
})
