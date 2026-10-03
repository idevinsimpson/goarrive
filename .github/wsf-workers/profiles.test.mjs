import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { plan, command, executionEnv, parseArgs, registry, atLeast, credentialProblems } from './launch.mjs';
import { summarize } from './report-smoke.mjs';
for (const worker of ['L0', 'W3', 'W4', 'W5', 'W7', 'W9']) {
  test(`${worker}: deterministic, serializable and role-bounded`, () => {
    const p = plan(worker);
    assert.deepEqual(plan(worker), p);
    assert.deepEqual(JSON.parse(JSON.stringify(p)), p);
    assert.equal(p.inbox, registry.workers[worker].inbox);
    assert.equal(p.settings.maxEffortLevel, p.settings.effortLevel);
    assert.equal(p.settings.disableWorkflows, !p.settings.ultracode);
    assert.equal(p.settings.workflowSizeGuideline, 'small');
    assert.ok(p.maxTurns <= 40);
    assert.equal(p.timeoutMinutes, 30);
  });
}
test('exact supported worker set only', () => {
  assert.deepEqual(Object.keys(registry.workers).sort(), ['L0','W3','W4','W5','W7','W9']);
  for (const bad of ['W1','W8','__proto__','../../W7','W7\nx=1','']) assert.throws(() => plan(bad));
});
test('security stays Opus without automatic orchestration', () => {
  assert.equal(plan('W5').settings.model, 'claude-opus-5-5');
  assert.equal(plan('W5').settings.effortLevel, 'xhigh');
  assert.equal(plan('W5').settings.ultracode, false);
  assert.throws(() => plan('W5','economy')); assert.throws(() => plan('W5','ultracode'));
});
test('requested W7/W9 Ultracode persists as a boolean independent of effort', () => {
  for (const w of ['W7','W9']) { assert.equal(plan(w).settings.ultracode,true); assert.equal(plan(w).settings.effortLevel,'high'); }
});
test('economy turns orchestration off; deep is explicitly different', () => {
  for (const w of ['W3','W4','W7','W9']) {
    assert.equal(plan(w,'economy').settings.ultracode,false);
    assert.equal(plan(w,'deep').settings.model,'claude-opus-5-5');
    assert.equal(plan(w,'deep').settings.ultracode,false);
  }
  assert.throws(() => plan('W7','auto'));
});
test('default production boundaries are not permissions escalation', () => {
  for(const w of Object.keys(registry.workers)) {
    const p=plan(w); assert.equal(p.settings.permissions,undefined); assert.equal(p.settings.env,undefined);
    assert.equal(p.settings.effortLevel === 'ultracode',false);
  }
  assert.equal(registry.automaticCutover,false);
});
test('L0 is not a second executable integrator',()=>assert.throws(()=>command(plan('L0'),'/tmp/x')));
test('explicit model, effort and settings accompany every resumed run',()=>{
  const c=command(plan('W7'),'/tmp/w7.json','session_123');
  assert.deepEqual(c.slice(0,6),['--model','claude-sonnet-5-5','--effort','high','--settings','/tmp/w7.json']);
  assert.ok(c.includes('--max-turns')); assert.deepEqual(c.slice(-2),['--resume','session_123']);
  assert.throws(()=>command(plan('W7'),'/tmp/x','--model opus'));
});
test('conflicting session env is reset without rewriting provider auth',()=>{
  const old={ANTHROPIC_MODEL:'wrong',CLAUDE_CODE_EFFORT_LEVEL:'xhigh',CLAUDE_CODE_DISABLE_WORKFLOWS:'1',KEEP:'yes'};
  const env=executionEnv(plan('W7'),old);
  assert.equal(env.ANTHROPIC_MODEL,'claude-sonnet-5-5'); assert.equal(env.CLAUDE_CODE_EFFORT_LEVEL,'high');
  assert.equal(env.CLAUDE_CODE_DISABLE_WORKFLOWS,undefined); assert.equal(env.KEEP,'yes'); assert.equal(old.ANTHROPIC_MODEL,'wrong');
  assert.equal(executionEnv(plan('W5'),{}).CLAUDE_CODE_DISABLE_WORKFLOWS,'1');
});
test('modern Ultracode semantics have a version floor',()=>{
  assert.equal(atLeast('2.1.288 (Claude Code)'),true); assert.equal(atLeast('2.1.284'),true);
  for(const x of ['2.1.283','2.0.99','unknown','garbage 2.1.288x']) assert.equal(atLeast(x),false);
});
test('unknown and duplicate flags never pass through to Claude',()=>{
  for(const a of [['plan','W7','--model','opus'],['run','W7'],['plan','W7','--tier','deep','--tier','economy'],['run','W7','--dangerously-skip-permissions'],['plan','W7','--resume','abc']]) assert.throws(()=>parseArgs(a));
  assert.equal(parseArgs(['plan','W7','--tier','economy']).tier,'economy');
});
const result=(model='claude-sonnet-5-5')=>({type:'result',subtype:'success',is_error:false,result:'WSF_PROFILE_SMOKE_OK',modelUsage:{[model]:{inputTokens:1}},secretToolOutput:'must not be published'});
test('smoke emits only observed model fields, not transcripts or invented effort proof',()=>{
  const r=summarize(JSON.stringify([result()]),'claude-sonnet-5-5');
  assert.equal(r.modelMatch,true); assert.equal(JSON.stringify(r).includes('secretToolOutput'),false);
  assert.match(r.ultracodeEvidence,/not attested/);
  assert.equal(summarize(JSON.stringify(result()),'claude-sonnet-5-5').modelMatch,true);
});
test('model fallback is not reported as the requested model',()=>assert.throws(()=>summarize(JSON.stringify(result('claude-opus-5-5')),'claude-sonnet-5-5')));
test('missing or failed runtime result is never a pass',()=>{
  for(const x of [{},{...result(),is_error:true},{...result(),modelUsage:{}},{...result(),result:'other'}]) assert.throws(()=>summarize(JSON.stringify(x),'claude-sonnet-5-5'));
});
const workflow=fs.readFileSync(new URL('../workflows/wsf-worker-profiles.yml',import.meta.url),'utf8');
test('workflow is owner/main-only, manual and opt-in, with no cloud mutation grants',()=>{
  assert.match(workflow,/workflow_dispatch:/); assert.doesNotMatch(workflow,/^\s*(issue_comment|schedule|pull_request_target|push):/m);
  assert.match(workflow,/github.actor == 'idevinsimpson'/); assert.match(workflow,/github.ref == 'refs\/heads\/main'/);
  assert.match(workflow,/vars.WSF_WORKER_PROFILE_SMOKE == 'enabled'/); assert.match(workflow,/default: plan/);
  assert.doesNotMatch(workflow,/^\s*(contents|actions|issues|pull-requests|id-token): write/m);
  assert.doesNotMatch(workflow,/WSF_CONTROL_WRITER_PRIVATE_KEY|anthropic_api_key:/);
  assert.match(workflow,/--max-turns 1 --tools ""/);
  assert.match(workflow,/show_full_output: 'false'/); assert.match(workflow,/display_report: 'false'/);
  assert.match(workflow,/settings: \$\{\{ needs.plan.outputs.settings \}\}/);
  for(const m of workflow.matchAll(/uses: [^@\s]+@([^\s]+)/g)) assert.match(m[1],/^[a-f0-9]{40}$/);
});
// Exercise the real wrapper with a fake CLI: no network, credential or model call.
// The child environment is built from scratch so the host's own variables
// (a CI or cloud session's provider/endpoint settings) cannot leak in.
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const SECRET='oat-fixture-SECRET-VALUE-0123';
const FAKE=`#!/usr/bin/env node
const fs=require('fs');const e=process.env;const a=process.argv.slice(2);
if(a[0]==='--version'){console.log((e.WSF_TEST_VERSION||'2.1.288')+' (Claude Code)');process.exit(0);}
if(a[0]==='auth'&&a[1]==='status'){
  fs.appendFileSync(e.WSF_TEST_AUTHLOG,'auth\\n');
  if(e.WSF_TEST_AUTH_RAW!==undefined){process.stdout.write(e.WSF_TEST_AUTH_RAW);process.exit(Number(e.WSF_TEST_AUTH_EXIT||0));}
  // Documented precedence: provider > AUTH_TOKEN > API_KEY > apiKeyHelper > OAUTH_TOKEN > profile > /login.
  const m=e.CLAUDE_CODE_USE_BEDROCK||e.CLAUDE_CODE_USE_VERTEX||e.CLAUDE_CODE_USE_FOUNDRY?'third_party':e.ANTHROPIC_AUTH_TOKEN||e.ANTHROPIC_API_KEY?'api_key':e.CLAUDE_CODE_OAUTH_TOKEN?'oauth_token':'none';
  const j=Object.assign({loggedIn:m!=='none',authMethod:m,apiProvider:'firstParty',configDirectory:e.CLAUDE_CONFIG_DIR,email:'fixture@example.test'},JSON.parse(e.WSF_TEST_AUTH_OVERRIDE||'{}'));
  console.log(JSON.stringify(j));process.exit(m==='none'?1:0);
}
let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{
  const authVars=Object.keys(e).filter(k=>/^(ANTHROPIC_|CLAUDE_CODE_USE_)/.test(k)&&k!=='ANTHROPIC_MODEL');
  fs.writeFileSync(e.WSF_TEST_TRACE,JSON.stringify({args:a,settings:JSON.parse(fs.readFileSync(a[a.indexOf('--settings')+1],'utf8')),model:e.ANTHROPIC_MODEL,effort:e.CLAUDE_CODE_EFFORT_LEVEL,configDir:e.CLAUDE_CONFIG_DIR,oauth:!!e.CLAUDE_CODE_OAUTH_TOKEN,authVars,prompt:s}));});
`;
function fakeCLI(version='2.1.288') {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wsf-cli-test-'));
  fs.writeFileSync(path.join(dir,'claude'),FAKE,{mode:0o700});
  fs.writeFileSync(path.join(dir,'prompt.txt'),'Bounded fixture task, no real work.');
  const config=path.join(dir,'worker-config'); fs.mkdirSync(config); fs.mkdirSync(path.join(dir,'home'));
  return {dir,config,trace:path.join(dir,'trace.json'),authlog:path.join(dir,'auth.log'),env:{
    PATH:[dir,path.dirname(process.execPath),'/usr/bin','/bin'].join(path.delimiter),HOME:path.join(dir,'home'),
    WSF_TEST_TRACE:path.join(dir,'trace.json'),WSF_TEST_AUTHLOG:path.join(dir,'auth.log'),WSF_TEST_VERSION:version,
    WSF_WORKER_LAUNCH_CONFIRMED:'existing-executor-stopped',WSF_WORKER_CONFIG_DIR:config,CLAUDE_CODE_OAUTH_TOKEN:SECRET}};
}
const launcher=fileURLToPath(new URL('./launch.mjs',import.meta.url));
const launch=(f,env=f.env,extra=[])=>spawnSync(process.execPath,[launcher,'run','W7','--prompt-file',path.join(f.dir,'prompt.txt'),...extra],{env,encoding:'utf8'});
const authCalls=(f)=>fs.existsSync(f.authlog)?fs.readFileSync(f.authlog,'utf8').split('\n').filter(Boolean).length:0;
function withFake(fn,version){const f=fakeCLI(version);try{fn(f);}finally{fs.rmSync(f.dir,{recursive:true,force:true});}}
/** A refusal: nonzero, no model invocation, and no secret value anywhere in the output. */
function refused(f,r,secrets=[]){
  assert.notEqual(r.status,0,r.stdout);
  assert.equal(fs.existsSync(f.trace),false,'no model invocation');
  for(const v of [SECRET,...secrets]) { assert.equal(r.stderr.includes(v),false,'secret value in stderr'); assert.equal(r.stdout.includes(v),false,'secret value in stdout'); }
  assert.match(r.stderr,/WSF_PROFILE_REFUSED/);
}
test('two real wrapper invocations reapply W7 profile and the same subscription preflight across resume',()=>withFake((f)=>{
  let first;
  for(let i=0;i<2;i++){
    const r=launch(f,{...f.env,ANTHROPIC_MODEL:'old',CLAUDE_CODE_EFFORT_LEVEL:'medium'},i?['--resume','session_fixture']:[]);
    assert.equal(r.status,0,r.stderr);
    assert.equal(authCalls(f),i+1,'auth status preflight runs on every launch');
    const t=JSON.parse(fs.readFileSync(f.trace,'utf8'));
    assert.equal(t.settings.ultracode,true);assert.equal(t.settings.effortLevel,'high');
    assert.equal(t.model,'claude-sonnet-5-5');assert.equal(t.effort,'high');
    assert.equal(t.configDir,f.config);assert.equal(t.oauth,true);assert.deepEqual(t.authVars,[]);
    assert.deepEqual(t.args.slice(t.args.indexOf('--setting-sources'),t.args.indexOf('--setting-sources')+2),['--setting-sources','user']);
    assert.equal(t.settings.env,undefined);assert.equal(t.settings.apiKeyHelper,undefined);
    assert.equal(fs.existsSync(t.args[t.args.indexOf('--settings')+1]),false,'temporary settings removed');
    assert.equal(r.stdout.includes(SECRET)||r.stderr.includes(SECRET),false);
    if(first)assert.deepEqual(t.settings,first);else first=t.settings;
    if(i===0)fs.rmSync(f.trace);
  }
}));
test('a conflicting credential, provider, endpoint or profile never reaches the model, initial or resume',()=>{
  const conflicts={ANTHROPIC_API_KEY:'sk-ant-fixture-SECRET-api',ANTHROPIC_AUTH_TOKEN:'fixture-SECRET-bearer',
    CLAUDE_CODE_USE_BEDROCK:'1',CLAUDE_CODE_USE_VERTEX:'1',CLAUDE_CODE_USE_FOUNDRY:'1',CLAUDE_CODE_USE_FUTURE_CLOUD:'1',
    ANTHROPIC_BASE_URL:'https://gateway.fixture.test/SECRET-path',ANTHROPIC_PROFILE:'fixture',ANTHROPIC_FEDERATION_RULE_ID:'fdrl_x',
    ANTHROPIC_ORGANIZATION_ID:'org_x',CLAUDE_CODE_PROVIDER_MANAGED_BY_HOST:'1',CLAUDE_CODE_SIMPLE:'1',AWS_BEARER_TOKEN_BEDROCK:'fixture-SECRET-aws',
    CLAUDE_CODE_OAUTH_REFRESH_TOKEN:'fixture-SECRET-refresh'};
  for(const [k,v] of Object.entries(conflicts)) for(const resume of [[],['--resume','session_fixture']]) withFake((f)=>{
    const r=launch(f,{...f.env,[k]:v},resume);
    refused(f,r,[v]); assert.match(r.stderr,new RegExp(k)); assert.equal(authCalls(f),0,`${k}: refused before any CLI auth call`);
  });
});
test('no subscription token: refused before any CLI call',()=>withFake((f)=>{
  const env={...f.env};delete env.CLAUDE_CODE_OAUTH_TOKEN;
  const r=launch(f,env);refused(f,r);assert.match(r.stderr,/CLAUDE_CODE_OAUTH_TOKEN/);assert.equal(authCalls(f),0);
}));
test('the config directory must be dedicated: absent, relative, stored login or credential settings refuse',()=>{
  withFake((f)=>{const env={...f.env};delete env.WSF_WORKER_CONFIG_DIR;refused(f,launch(f,env));assert.equal(authCalls(f),0);});
  // A relative path that does exist from the launch directory is still refused.
  withFake((f)=>{const r=spawnSync(process.execPath,[launcher,'run','W7','--prompt-file',path.join(f.dir,'prompt.txt')],{cwd:f.dir,env:{...f.env,WSF_WORKER_CONFIG_DIR:'worker-config'},encoding:'utf8'});
    refused(f,r);assert.match(r.stderr,/absolute/);assert.equal(authCalls(f),0);});
  withFake((f)=>{refused(f,launch(f,{...f.env,WSF_WORKER_CONFIG_DIR:path.join(f.dir,'missing')}));});
  withFake((f)=>{fs.writeFileSync(path.join(f.config,'.credentials.json'),'{"fixture":"SECRET-stored-login"}');
    const r=launch(f);refused(f,r,['SECRET-stored-login']);assert.match(r.stderr,/stored login/);assert.equal(authCalls(f),0);});
  for(const settings of [{apiKeyHelper:'/bin/echo fixture-SECRET-helper'},{env:{ANTHROPIC_API_KEY:'fixture-SECRET-env'}},
    {awsAuthRefresh:'x'},{forceLoginMethod:'console'},{otelHeadersHelper:'x'}]) withFake((f)=>{
    fs.writeFileSync(path.join(f.config,'settings.json'),JSON.stringify(settings));
    const r=launch(f);refused(f,r,['fixture-SECRET-helper','fixture-SECRET-env']);assert.equal(authCalls(f),0,'a helper is never run to discover its output');
  });
  withFake((f)=>{fs.writeFileSync(path.join(f.config,'settings.json'),'{not json');refused(f,launch(f));assert.equal(authCalls(f),0);});
  withFake((f)=>{fs.writeFileSync(path.join(f.config,'settings.json'),JSON.stringify({theme:'dark'}));assert.equal(launch(f).status,0);});
});
test('effective auth must be the subscription OAuth token for the same config directory, or the run refuses',()=>{
  for(const override of [{authMethod:'api_key'},{authMethod:'api_key_helper'},{authMethod:'third_party'},{authMethod:'claude.ai'},
    {authMethod:'none'},{authMethod:'future_mode'},{authMethod:null},{apiProvider:'bedrock'},{configDirectory:'/elsewhere'},{configDirectory:null}]) withFake((f)=>{
    const r=launch(f,{...f.env,WSF_TEST_AUTH_OVERRIDE:JSON.stringify(override)});
    refused(f,r,['fixture@example.test']);assert.equal(authCalls(f),1);
  });
  for(const [raw,exit] of [['not json','0'],['[]','0'],['','0'],['{"authMethod":"oauth_token"}','1']]) withFake((f)=>{
    refused(f,launch(f,{...f.env,WSF_TEST_AUTH_RAW:raw,WSF_TEST_AUTH_EXIT:exit}));
  });
  // Otherwise-valid subscription output with a failing exit status is still a refusal.
  withFake((f)=>{
    const ok=JSON.stringify({loggedIn:true,authMethod:'oauth_token',apiProvider:'firstParty',configDirectory:f.config});
    assert.equal(launch(f,{...f.env,WSF_TEST_AUTH_RAW:ok,WSF_TEST_AUTH_EXIT:'0'}).status,0);
    fs.rmSync(f.trace);
    refused(f,launch(f,{...f.env,WSF_TEST_AUTH_RAW:ok,WSF_TEST_AUTH_EXIT:'1'}));
  });
});
test('auth status output is never echoed, even on refusal',()=>withFake((f)=>{
  const r=launch(f,{...f.env,WSF_TEST_AUTH_OVERRIDE:JSON.stringify({authMethod:'api_key',email:'leak-SECRET@example.test',orgName:'SECRET-org'})});
  refused(f,r,['leak-SECRET@example.test','SECRET-org']);assert.match(r.stderr,/api_key/);
}));
test('plan never invokes a CLI even with conflicting credentials and a fake CLI installed',()=>withFake((f)=>{
  const r=spawnSync(process.execPath,[launcher,'plan','W7'],{env:{...f.env,ANTHROPIC_API_KEY:'sk-ant-fixture-SECRET'},encoding:'utf8'});
  assert.equal(r.status,0);assert.equal(fs.existsSync(f.trace),false);assert.equal(authCalls(f),0);
  assert.equal(r.stdout.includes('sk-ant-fixture-SECRET'),false);
}));
test('old runtime refuses before first model request',()=>withFake((f)=>{
  const r=launch(f);refused(f,r);assert.equal(authCalls(f),0);
},'2.1.203'));
test('unconfirmed executor handover refuses before CLI invocation',()=>withFake((f)=>{
  const env={...f.env};delete env.WSF_WORKER_LAUNCH_CONFIRMED;
  refused(f,launch(f,env));assert.equal(authCalls(f),0);
}));
test('credentialProblems names variables, never values',()=>{
  const p=credentialProblems({ANTHROPIC_API_KEY:'sk-ant-SECRET',ANTHROPIC_MODEL:'claude-sonnet-5-5',CLAUDE_CODE_OAUTH_TOKEN:SECRET,EMPTY:''});
  assert.deepEqual(p,['conflicting credential/provider/endpoint variable ANTHROPIC_API_KEY is set']);
  assert.deepEqual(credentialProblems({CLAUDE_CODE_OAUTH_TOKEN:SECRET,ANTHROPIC_MODEL:'x',ANTHROPIC_API_KEY:''}),[]);
  assert.match(credentialProblems({CLAUDE_CODE_OAUTH_TOKEN:'  '}).join(),/absent/);
});
