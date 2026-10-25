import fs from 'fs';
import path from 'path';
import ts from 'typescript';
import vm from 'vm';
const source=ts.createSourceFile('index.ts',fs.readFileSync(path.resolve(__dirname,'../index.ts'),'utf8'),ts.ScriptTarget.Latest,true);
function harness(name:string, member=false) {
  let declaration='';
  source.forEachChild(n=>{if(ts.isVariableStatement(n))for(const d of n.declarationList.declarations)if(d.name.getText(source)===name)declaration=`const ${d.getText(source)};globalThis.invoke=${name};`;});
  const mutate=jest.fn(),provider=jest.fn(),move=jest.fn(),begin=jest.fn(async()=> 'own-lock'),finish=jest.fn(),window=jest.fn();
  const context:any={db:{collection:()=>({doc:()=>({get:async()=>({exists:true,data:()=>({coachId:'coach',memberId:'member',status:'allocated',playbookId:'plan'})}),update:mutate})})},onCall:(_:any,f:any)=>f,ownsSessionMember:()=>member,assertWithinSkipAutoApprovalWindow:window,beginBotSessionMutation:begin,finishBotSessionMutation:finish,prepareBotRescheduleReservation:move,moveReservationForInstance:move,getZoomProvider:provider,HttpsError:Error};
  for(const key of ['zoomAccountId','zoomClientId','zoomClientSecret','emailApiKey','twilioAccountSid','twilioAuthToken','twilioFromNumber'])context[key]={value:()=>''};
  vm.createContext(context);vm.runInContext(ts.transpile(declaration,{target:ts.ScriptTarget.ES2020}),context);
  return {mutate,provider,move,begin,finish,window,invoke:()=>context.invoke({auth:{uid:member?'member':'coach',token:{}},data:{instanceId:'s',newDate:'2026-11-01',newStartTime:'12:00'}})};
}
test.each(['cancelInstance','rescheduleInstance'])('%s checks unsupported managed mutation before reservation/provider/session writes',async name=>{
  const h=harness(name);h.begin.mockRejectedValue(Error('reconcile first'));
  await expect(h.invoke()).rejects.toThrow('reconcile first');
  expect(h.begin).toHaveBeenCalledTimes(1);expect(h.mutate).not.toHaveBeenCalled();expect(h.provider).not.toHaveBeenCalled();expect(h.move).not.toHaveBeenCalled();expect(h.finish).not.toHaveBeenCalled();
});
test.each(['cancelInstance','rescheduleInstance'])('%s denied member window never acquires a lock',async name=>{
  const h=harness(name,true);h.window.mockRejectedValue(Error('outside allowed window'));
  await expect(h.invoke()).rejects.toThrow('outside allowed window');
  expect(h.begin).not.toHaveBeenCalled();expect(h.finish).not.toHaveBeenCalled();expect(h.mutate).not.toHaveBeenCalled();expect(h.provider).not.toHaveBeenCalled();
});
test('transactional overlap rejection releases own lock without uncertain provider state',async()=>{
  const h=harness('rescheduleInstance');h.move.mockRejectedValue(Object.assign(Error('conflict'),{code:'already-exists'}));
  await expect(h.invoke()).rejects.toThrow('conflict');
  expect(h.finish).toHaveBeenCalledWith(expect.anything(),'s','own-lock',false);
  expect(h.finish.mock.calls.some(args=>args[3]===true)).toBe(false);
  expect(h.mutate).not.toHaveBeenCalled();expect(h.provider).not.toHaveBeenCalled();
});
