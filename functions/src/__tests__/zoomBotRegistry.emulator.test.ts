import * as admin from 'firebase-admin';
import {reconcileBotHost,assertBotJoinCapacity} from '../zoomBotRegistry';
import {createFencedLegacyMeeting} from '../zoomBotLegacyFence';
import {botHostKey} from '../zoomBotReservation';
if(process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8080')throw Error('Local emulator required');
jest.setTimeout(30000);
const app=admin.initializeApp({projectId:'demo-bot-registry'},'bot-registry'),db=app.firestore();
const email='host@example.invalid',hostId=botHostKey(email),auth={uid:'admin',token:{role:'platformAdmin'}};
const input={email,roomId:'room',legacyRoomIds:['old']};let provider:any;
beforeEach(async()=>{
 for(const col of ['zoom_bot_hosts','zoom_bot_registration_fences','zoom_bot_legacy_attempts','zoom_rooms','session_instances','session_video_receipts','zoom_bot_host_leases','zoom_bot_allocation_jobs','zoom_bot_legacy_releases']){const docs=await db.collection(col).get();const batch=db.batch();docs.docs.forEach(d=>batch.delete(d.ref));await batch.commit();}
 await db.doc('zoom_rooms/room').set({status:'active',poolId:'hmti',zoomAccountEmail:email,zoomUserId:'verified-id'});
 provider={mode:'live',getMeeting:jest.fn(async()=>null),inspectHost:jest.fn(async()=>({email,providerUserId:'verified-id',active:true,userType:2,sameAccount:true})),inspectHostOccupancy:jest.fn(async()=>[]),createMeeting:jest.fn(async()=>({meetingId:'123'}))};
});
afterAll(()=>app.delete());
test('only admin can reconcile; normal coach cannot write registry',async()=>{await expect(reconcileBotHost(db,provider,{uid:'coach',token:{role:'coach'}},input)).rejects.toMatchObject({code:'permission-denied'});expect(provider.inspectHost).not.toHaveBeenCalled();expect((await db.collection('zoom_bot_hosts').get()).empty).toBe(true);});
test('verified registration fences later legacy creates without calling provider',async()=>{await reconcileBotHost(db,provider,auth,input);await expect(createFencedLegacyMeeting(db,provider,{hostEmail:email,topic:'test',startTime:new Date().toISOString(),duration:45,timezone:'UTC'})).rejects.toMatchObject({code:'failed-precondition'});expect(provider.createMeeting).not.toHaveBeenCalled();});
test('in-flight legacy provider call prevents registration',async()=>{
 let finish:any;let started:any;const entered=new Promise(r=>started=r);
 provider.createMeeting.mockImplementation(()=>{started();return new Promise(r=>finish=r);});
 const pending=createFencedLegacyMeeting(db,provider,{hostEmail:email,topic:'test',startTime:new Date().toISOString(),duration:45,timezone:'UTC'});await entered;
 await expect(reconcileBotHost(db,provider,auth,input)).rejects.toMatchObject({code:'failed-precondition'});
 finish({meetingId:'123'});await pending;await reconcileBotHost(db,provider,auth,input);
 expect((await db.doc('zoom_bot_hosts/'+hostId).get()).data()?.status).toBe('active');
});
test('provider inventory failure leaves host quiesced and legacy path fenced',async()=>{provider.inspectHostOccupancy.mockRejectedValue(Error('synthetic'));await expect(reconcileBotHost(db,provider,auth,input)).rejects.toThrow();expect((await db.doc('zoom_bot_hosts/'+hostId).get()).data()?.status).toBe('quiescing');});
async function admission(){await reconcileBotHost(db,provider,auth,input);const now=Date.now();await db.doc('session_instances/s').set({status:'allocated',zoomMeetingId:'current',startUtc:admin.firestore.Timestamp.fromMillis(now-1000),endUtc:admin.firestore.Timestamp.fromMillis(now+60000)});await db.doc('session_video_receipts/s').set({botHostId:hostId,meetingId:'current'});await db.doc('zoom_bot_allocation_jobs/s').set({state:'completed',meetingId:'current'});provider.inspectHostOccupancy.mockResolvedValue([{meetingId:'current',startMs:now-1000,endMs:now+60000,live:false}]);}
test('already allocated later session cannot join while prior meeting overruns',async()=>{await admission();provider.inspectHostOccupancy.mockResolvedValue([{meetingId:'current',startMs:Date.now(),endMs:Date.now()+60000,live:false},{meetingId:'prior',startMs:Date.now()-3600000,endMs:Date.now()-60000,live:true}]);await expect(assertBotJoinCapacity(db,provider,'s','current')).rejects.toMatchObject({code:'resource-exhausted'});});
test('fresh current-only observation permits join; cancellation during observation rejects',async()=>{await admission();await expect(assertBotJoinCapacity(db,provider,'s','current')).resolves.toBeUndefined();const inventory=await provider.inspectHostOccupancy();provider.inspectHostOccupancy.mockImplementation(async()=>{await db.doc('session_instances/s').update({status:'cancelled'});return inventory;});await expect(assertBotJoinCapacity(db,provider,'s','current')).rejects.toMatchObject({code:'failed-precondition'});});

test('legacy cancelled row only releases occupancy after provider confirms meeting absence',async()=>{
 await db.doc('session_instances/old-session').set({zoomRoomId:'old',zoomMeetingId:'123',status:'cancelled'});
 provider.getMeeting.mockResolvedValue({meetingId:'123'});await reconcileBotHost(db,provider,auth,input);
 expect((await db.doc('zoom_bot_legacy_releases/old-session').get()).exists).toBe(false);
 provider.getMeeting.mockResolvedValue(null);await reconcileBotHost(db,provider,auth,input);
 expect((await db.doc('zoom_bot_legacy_releases/old-session').get()).data()).toMatchObject({meetingId:'123',providerUserId:'verified-id'});
});
test('mapping changes cannot overwrite an existing capacity hold',async()=>{
 await reconcileBotHost(db,provider,auth,input);await db.doc('zoom_bot_host_leases/'+hostId).set({windows:[{sessionId:'s',released:false}]});
 await expect(reconcileBotHost(db,provider,auth,{...input,roomId:'new-room'})).rejects.toMatchObject({code:'failed-precondition'});
 expect((await db.doc('zoom_bot_hosts/'+hostId).get()).data()?.roomId).toBe('room');
});
