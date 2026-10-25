import {initializeTestEnvironment,assertFails,RulesTestEnvironment} from '@firebase/rules-unit-testing';
import {doc,getDoc,setDoc} from 'firebase/firestore';
import {readFileSync} from 'fs';import {resolve} from 'path';
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8080')throw Error('Local emulator required');
jest.setTimeout(60000);let env:RulesTestEnvironment;
beforeAll(async()=>{env=await initializeTestEnvironment({projectId:'demo-bot-private-rules',firestore:{host:'127.0.0.1',port:8080,rules:readFileSync(resolve(__dirname,'../../../firestore.rules'),'utf8')}});});
afterAll(async()=>env?.cleanup());
test.each(['member','coach','platformAdmin'])('%s cannot read or forge private host coordination documents',async role=>{
 const db=env.authenticatedContext('synthetic',{role}).firestore();
 for(const name of ['zoom_bot_hosts','zoom_bot_registration_fences','zoom_bot_legacy_attempts','zoom_bot_allocation_jobs','zoom_bot_host_leases','zoom_bot_allocation_history','zoom_bot_orphan_attempts','zoom_bot_legacy_releases']){
  await assertFails(getDoc(doc(db,name,'synthetic')));await assertFails(setDoc(doc(db,name,'synthetic'),{verified:true,status:'active'}));
 }
});
