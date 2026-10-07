import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { createRequire } from 'node:module'
const require=createRequire(import.meta.url)
const tick=()=>new Promise(resolve=>setImmediate(resolve))

test('native images deduplicate, cap concurrency, discard stale sessions and retry failures',async()=>{
 const storage=new Map([['token','first']]),downloads=[],removed=[]
 const app={globalData:{drafts:{}}}
 const module={exports:{}}
 const wx={getStorageSync:k=>storage.get(k),removeStorageSync:k=>storage.delete(k),getFileSystemManager:()=>({unlink:o=>removed.push(o.filePath)}),downloadFile:o=>downloads.push(o)}
 vm.runInNewContext(readFileSync(new URL('../../miniprogram/utils/api.js',import.meta.url),'utf8'),{module,wx,getApp:()=>app})
 const api=module.exports
 const first=api.image('/one','cover')
 assert.equal(api.image('/one','cover'),first)
 const rest=['/two','/three','/four'].map(url=>api.image(url,'cover'))
 assert.equal(downloads.length,3)
 assert.match(downloads[0].url,/size=cover$/)
 downloads[0].success({statusCode:200,tempFilePath:'/one.png'});downloads[0].complete()
 assert.equal(await first,'/one.png');assert.equal(downloads.length,4)
 downloads[1].fail();downloads[1].complete();assert.equal(await rest[0],'')
 const retry=api.image('/two','cover');assert.equal(downloads.length,5)
 api.clear();storage.set('token','second')
 for(const i of [2,3,4]){downloads[i].success({statusCode:200,tempFilePath:'/stale.png'});downloads[i].complete()}
 assert.deepEqual(await Promise.all([rest[1],rest[2],retry]),['','',''])
 assert.ok(removed.includes('/one.png'));assert.ok(removed.includes('/stale.png'))
 const patch=[],page={generation:1,setData:p=>patch.push(p)}
 api.loadImages(page,[{path:'cover',url:'/new',size:'cover'}]);page.generation++
 downloads[5].success({statusCode:200,tempFilePath:'/new.png'});downloads[5].complete();await tick()
 assert.equal(patch.length,0)
})

test('native home renders records before images and ignores an older query response',async()=>{
 const domain=require('../../miniprogram/utils/domain.js'),requests=[],images=[]
 let page
 const api={query:()=>'',request:()=>new Promise(resolve=>requests.push(resolve)),loadImages:(...args)=>images.push(args)}
 vm.runInNewContext(readFileSync(new URL('../../miniprogram/pages/home/home.js',import.meta.url),'utf8'),{require:name=>name.endsWith('/api')?api:domain,Page:p=>page=p})
 page.setData=patch=>Object.assign(page.data,patch)
 const older=page.load(),newer=page.load()
 requests[1]({records:[{id:'2',item_name:'新查询',cover_url:'/two',campus:'xiasha'}],total:1})
 await newer
 assert.equal(page.data.loading,false);assert.equal(page.data.records[0].item_name,'新查询');assert.equal(page.data.records[0].cover,'');assert.equal(images.length,1)
 requests[0]({records:[{id:'1',item_name:'旧查询'}],total:1});await older
 assert.equal(page.data.records[0].id,'2');assert.equal(images.length,1)
 page.onUnload();assert.notEqual(page.generation,images[0][2])
})
