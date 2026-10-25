import fs from 'fs';import path from 'path';import ts from 'typescript';import vm from 'vm';
import {HttpsError} from 'firebase-functions/v2/https';
const source=ts.createSourceFile('index.ts',fs.readFileSync(path.resolve(__dirname,'../index.ts'),'utf8'),ts.ScriptTarget.Latest,true);
test.each(['reconcileZoomBotHost','reconcileZoomBotAttempt'])('%s is off by default and rejects coach access before any provider call',async name=>{
 const node=source.statements.find(n=>ts.isVariableStatement(n)&&n.declarationList.declarations.some(d=>d.name.getText(source)===name))!;
 const provider=jest.fn(),mutate=jest.fn();const context:any={exports:{},onCall:(_:any,f:any)=>f,HttpsError,process:{env:{}},getZoomProvider:provider,reconcileBotHost:mutate,reconcileBotAttempt:mutate,zoomAccountId:{value:()=>''},zoomClientId:{value:()=>''},zoomClientSecret:{value:()=>''}};
 vm.runInNewContext(ts.transpileModule(node.getText(source),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,context);
 await expect(context.exports[name]({auth:{uid:'admin',token:{role:'platformAdmin'}},data:{}})).rejects.toMatchObject({code:'failed-precondition'});
 context.process.env.ZOOM_BOT_MANAGEMENT_ENABLED='true';
 await expect(context.exports[name]({auth:{uid:'coach',token:{role:'coach'}},data:{}})).rejects.toMatchObject({code:'permission-denied'});
 expect(provider).not.toHaveBeenCalled();expect(mutate).not.toHaveBeenCalled();
});
