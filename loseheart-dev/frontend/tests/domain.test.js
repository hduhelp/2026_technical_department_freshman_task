import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { blankPost, validatePost, postPayload, passwordError } from '../src/domain.js'
const native=createRequire(import.meta.url)('../../miniprogram/utils/domain.js')
test('web and mini-program enforce the same post and password boundaries',()=>{
  const now=new Date('2026-10-07T10:00:00+08:00')
  const p={...blankPost(),post_type:'lost',item_name:'耳机',campus:'xiasha',location:'图书馆',description:'银色耳机',event_date:'2026-10-06',contact_methods:[{type:'wechat',value:'demo_wechat'}]}
  const cases=[p,{...p,item_name:' '},{...p,item_name:'😀'.repeat(51)},{...p,event_date:'2026-02-30'},{...p,event_date:'2026-10-08'},{...p,time_precision:'exact',event_time_start:'99:99'},{...p,time_precision:'range',event_time_start:'15:00',event_time_end:'14:00'},{...p,contact_methods:[{type:'phone',value:'123'}]},{...p,images:Array(7).fill('image')}]
  cases.forEach((c,i)=>{const errors=validatePost(c,now);assert.deepEqual(errors,native.validatePost(c,now));assert.equal(Object.keys(errors).length===0,i===0)})
  assert.equal(passwordError('password1','😀'.repeat(8),'😀'.repeat(8)),'')
  assert.notEqual(passwordError('password1','password1','password1'),'')
  assert.equal(postPayload({...p,event_time_start:'14:00'}).event_time_start,null)
  assert.equal(postPayload({...p,time_precision:'exact',event_time_start:'14:00',event_time_end:'15:00'}).event_time_end,null)
})
