import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { plan, command, executionEnv, parseArgs, registry, atLeast } from './launch.mjs';
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
// Exercise the real wrapper twice with a fake CLI: no network/model call.
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
function fakeCLI(version='2.1.288') {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'wsf-cli-test-'));
  const executable=path.join(dir,'claude');
  fs.writeFileSync(executable,`#!/usr/bin/env node\nconst fs=require('fs');\nif(process.argv[2]==='--version'){console.log('${version} (Claude Code)');process.exit(0);}\nlet s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{const a=process.argv.slice(2);fs.writeFileSync(process.env.WSF_TEST_TRACE,JSON.stringify({args:a,settings:JSON.parse(fs.readFileSync(a[a.indexOf('--settings')+1],'utf8')),model:process.env.ANTHROPIC_MODEL,effort:process.env.CLAUDE_CODE_EFFORT_LEVEL,prompt:s}));});\n`,{mode:0o700});
  fs.writeFileSync(path.join(dir,'prompt.txt'),'Bounded fixture task, no real work.');
  return {dir,env:{...process.env,PATH:dir+path.delimiter+process.env.PATH,WSF_TEST_TRACE:path.join(dir,'trace.json'),WSF_WORKER_LAUNCH_CONFIRMED:'existing-executor-stopped'}};
}
const launcher=fileURLToPath(new URL('./launch.mjs',import.meta.url));
test('two real wrapper invocations reapply W7 profile across resume',()=>{
  const f=fakeCLI();
  try {
    let first;
    for(let i=0;i<2;i++){
      const r=spawnSync(process.execPath,[launcher,'run','W7','--prompt-file',path.join(f.dir,'prompt.txt'),...(i?['--resume','session_fixture']:[])],{env:{...f.env,ANTHROPIC_MODEL:'old',CLAUDE_CODE_EFFORT_LEVEL:'medium'},encoding:'utf8'});
      assert.equal(r.status,0,r.stderr);
      const t=JSON.parse(fs.readFileSync(f.env.WSF_TEST_TRACE,'utf8'));
      assert.equal(t.settings.ultracode,true);assert.equal(t.settings.effortLevel,'high');
      assert.equal(t.model,'claude-sonnet-5-5');assert.equal(t.effort,'high');
      assert.equal(fs.existsSync(t.args[t.args.indexOf('--settings')+1]),false,'temporary settings removed');
      if(first)assert.deepEqual(t.settings,first);else first=t.settings;
    }
  } finally {fs.rmSync(f.dir,{recursive:true,force:true});}
});
test('plan never invokes a CLI even when a fake CLI is installed',()=>{
  const f=fakeCLI();try{
    const r=spawnSync(process.execPath,[launcher,'plan','W7'],{env:f.env,encoding:'utf8'});
    assert.equal(r.status,0);assert.equal(fs.existsSync(f.env.WSF_TEST_TRACE),false);
  }finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});
test('old runtime refuses before first model request',()=>{
  const f=fakeCLI('2.1.203');try{
    const r=spawnSync(process.execPath,[launcher,'run','W7','--prompt-file',path.join(f.dir,'prompt.txt')],{env:f.env,encoding:'utf8'});
    assert.notEqual(r.status,0);assert.equal(fs.existsSync(f.env.WSF_TEST_TRACE),false);
  }finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});
test('unconfirmed executor handover refuses before CLI invocation',()=>{
  const f=fakeCLI();try{
    const env={...f.env};delete env.WSF_WORKER_LAUNCH_CONFIRMED;
    const r=spawnSync(process.execPath,[launcher,'run','W7','--prompt-file',path.join(f.dir,'prompt.txt')],{env,encoding:'utf8'});
    assert.notEqual(r.status,0);assert.equal(fs.existsSync(f.env.WSF_TEST_TRACE),false);
  }finally{fs.rmSync(f.dir,{recursive:true,force:true});}
});
