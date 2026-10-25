import fs from 'fs';import path from 'path';import ts from 'typescript';import vm from 'vm';
const source=ts.createSourceFile('index.ts',fs.readFileSync(path.resolve(__dirname,'../index.ts'),'utf8'),ts.ScriptTarget.Latest,true);
test.each(['cancelInstance','rescheduleInstance'])('%s checks unsupported managed mutation before reservation/provider/session writes',async name=>{
  let declaration='';source.forEachChild(n=>{if(ts.isVariableStatement(n))for(const d of n.declarationList.declarations)if(d.name.getText(source)===name)declaration=`const ${d.getText(source)};globalThis.invoke=${name};`;});
  const mutate=jest.fn(),provider=jest.fn(),move=jest.fn(),begin=jest.fn(async()=>{throw Error('reconcile first');});
  const context:any={db:{collection:()=>({doc:()=>({get:async()=>({exists:true,data:()=>({coachId:'coach',memberId:'member',status:'allocated',playbookId:'plan'})}),update:mutate})})},onCall:(_:any,f:any)=>f,ownsSessionMember:()=>false,beginBotSessionMutation:begin,finishBotSessionMutation:mutate,moveReservationForInstance:move,getZoomProvider:provider,HttpsError:Error};
  for(const key of ['zoomAccountId','zoomClientId','zoomClientSecret','emailApiKey','twilioAccountSid','twilioAuthToken','twilioFromNumber'])context[key]={value:()=>''};
  vm.createContext(context);vm.runInContext(ts.transpile(declaration,{target:ts.ScriptTarget.ES2020}),context);
  await expect(context.invoke({auth:{uid:'coach',token:{}},data:{instanceId:'s',newDate:'2026-11-01',newStartTime:'12:00'}})).rejects.toThrow('reconcile first');
  expect(begin).toHaveBeenCalledTimes(1);expect(mutate).not.toHaveBeenCalled();expect(provider).not.toHaveBeenCalled();expect(move).not.toHaveBeenCalled();
});
