import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
const baseline=process.env.CGW_REGRESSION_BASELINE==='1';
const root='/Users/caoyujie/codes/camellia-golden-week';
const {advanceRealtime,createRealtime}=await import(baseline?'file:///tmp/camellia-firewall-v2-baseline-realtime.ts':`file://${root}/src/core/realtime.ts`);
const data=JSON.parse(readFileSync(`${root}/src/content/${baseline?'history/realtime-v2.json':'challenges/realtime.json'}`,'utf8'));
const definition=data.definitions.find(item=>item.id==='a.firewall.tutorial');
console.log(JSON.stringify({source:baseline?'HEAD 210a53e852dfbb0531cc54a592f995383d0583f3 frozen reducer + frozen v2 definition':'current workspace v3 reducer + v3 definition',ruleVersion:definition.ruleVersion}));
test('录像回归：六次成功后普通错拍只减1，得到5而非1',()=>{
 let state=createRealtime(definition);
 const period=60000/definition.rules.bpm;
 for(let index=0;index<6;index++){
  const activeTimeMs=definition.rules.firstBeatMs+index*period;
  state=advanceRealtime(definition,state,activeTimeMs,{kind:'move',direction:index%2===0?'right':'left',sequence:index+1,activeTimeMs}).state;
 }
 assert.equal(state.combo,6);
 const activeTimeMs=definition.rules.firstBeatMs+5*period+151;
 const result=advanceRealtime(definition,state,activeTimeMs,{kind:'move',direction:'right',sequence:7,activeTimeMs});
 assert.equal(result.state.combo,5);
 assert.equal(result.state.bestCombo,6);
});
