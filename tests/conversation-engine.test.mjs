import { test } from 'node:test';
import assert from 'node:assert/strict';
import { packTexts, planConversation, planConversationAsync, runConversation, REVIEW_PROMPT } from '../memory/conversation-engine.js';

const count = text => text.length;
const records = Array.from({ length: 5 }, (_, i) => ({id:`r${i}`,startId:i*20,endId:i*20+19,content:'scene '.repeat(230)}));
const fresh = () => ({question:'What happened?',records,budget:4000,first:true,history:[],cache:{},attempts:0});
const deps = generate => ({generate,count,save:async()=>{},progress:()=>{},check:()=>{}});
const review = prompt => {
    const data = JSON.parse(prompt.slice(REVIEW_PROMPT.length).trim());
    return JSON.stringify({answer:'There is a scene.',recordIds:[data.records[0].id]});
};

test('asynchronous preview matches execution batching including oversized records', async () => {
    const source = [...records, { id:'huge',content:'large '.repeat(3000) }];
    assert.deepEqual(await planConversationAsync(source,'question',4000,async text=>count(text)),planConversation(source,'question',4000,count));
});

test('planned batches fit actual prompts, preserve all records and count requests', async () => {
    const job = fresh();
    const plan = planConversation(records,job.question,job.budget,count);
    assert.deepEqual(plan.batches.flat().map(record=>record.id),records.map(record=>record.id));
    let calls=0;
    await runConversation(job,deps(async prompt=>{
        calls++; assert.ok(count(prompt)<=job.budget);
        if(prompt.startsWith(REVIEW_PROMPT)) return JSON.stringify({answer:'Nothing relevant',recordIds:[]});
        return JSON.stringify({action:'answer',answer:'Nothing found'});
    }));
    assert.equal(calls,plan.requests);
});

test('oversized individual record splits losslessly',()=>{
    const item={id:'a',content:'word '.repeat(1000)};
    const batches=packTexts([item],JSON.stringify,400,count);
    assert.equal(batches.flat().map(x=>x.content).join(''),item.content);
    assert.ok(batches.every(batch=>count(JSON.stringify(batch))<=400));
});

test('failure retry reuses completed responses including review batches',async()=>{
    const job=fresh(); let calls=0;
    await assert.rejects(runConversation(job,deps(async prompt=>{
        if(++calls===2) throw Error('network');
        return review(prompt);
    })),/network/);
    assert.equal(Object.keys(job.cache).length,1);
    let repeatedFirst=false;
    const firstPrompt=REVIEW_PROMPT+'\n'+JSON.stringify({question:job.question,records:planConversation(records,job.question,4000,count).batches[0]});
    const result=await runConversation(job,deps(async prompt=>{
        if(prompt===firstPrompt) repeatedFirst=true;
        if(prompt.startsWith(REVIEW_PROMPT)) return review(prompt);
        if(prompt.startsWith('Condense')) return 'Relevant scene [[r0]]';
        return JSON.stringify({action:'answer',answer:'Found it [[r0]]'});
    }));
    assert.equal(repeatedFirst,false); assert.match(result.answer,/Found/);
});

test('followup reads exact records and neighbors, then answers in two calls',async()=>{
    const job={...fresh(),first:false,evidence:'Earlier scene [[r2]]',budget:16000}; let calls=0;
    const result=await runConversation(job,deps(async prompt=>{
        if(++calls===1) return JSON.stringify({action:'read',recordIds:['r2'],neighbors:1});
        assert.ok(prompt.includes('r1') && prompt.includes('r3'));
        return JSON.stringify({action:'answer',answer:'Context'});
    }));
    assert.equal(calls,2); assert.equal(result.answer,'Context');
});

test('malformed JSON is not cached and can be retried',async()=>{
    const job=fresh();
    await assert.rejects(runConversation(job,deps(async()=>'{broken')));
    assert.equal(Object.keys(job.cache).length,0);
});

test('stop after response stores completed work before stopping',async()=>{
    const job=fresh(); let stopped=false;
    await assert.rejects(runConversation(job,{...deps(async prompt=>{stopped=true;return review(prompt);}),check:()=>{if(stopped)throw Error('stopped');}}),/stopped/);
    assert.equal(Object.keys(job.cache).length,1);
});

test('new followup topic scans all records and uses N plus two requests',async()=>{
    const job={...fresh(),first:false,evidence:'old evidence'};
    let calls=0;
    const result=await runConversation(job,deps(async prompt=>{
        calls++;
        if(calls===1)return JSON.stringify({action:'scan',question:'new topic'});
        if(prompt.startsWith(REVIEW_PROMPT))return JSON.stringify({answer:'No related scenes',recordIds:[]});
        return JSON.stringify({action:'answer',answer:'No scenes'});
    }));
    assert.equal(calls,planConversation(records,'new topic',job.budget,count).batches.length+2);
    assert.equal(result.answer,'No scenes');
});

test('direct followup retains evidence without nesting conversation history',async()=>{
    const job={...fresh(),first:false,evidence:'original evidence',history:[{role:'user',content:'earlier question'}]};
    const result=await runConversation(job,deps(async()=>JSON.stringify({action:'answer',answer:'reply'})));
    assert.equal(result.evidence,'original evidence');
    assert.equal(job.attempts,1);
});
