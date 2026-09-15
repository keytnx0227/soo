import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('custom requests use clean payloads and per-request output without mutating settings', async () => {
    const source = (await readFile(new URL('../connection/generation.js', import.meta.url),'utf8'))
        .replace(/^import[\s\S]*?from ['"][^'"]+['"];\s*/gm,'').replaceAll('export ','');
    const connection = {provider:'openai',model:'model',maxTokens:5000,temperature:0.8,topP:1,topK:0};
    const requests=[];
    const ctx={eventSource:{on(){},removeListener(){}},eventTypes:{GENERATION_STOPPED:'stop'},ChatCompletionService:{sendRequest:async data=>{requests.push(data);return {content:'reply'}}}};
    const scope={main_api:'openai',chat_completion_sources:{OPENAI:'openai'},oai_settings:{unwanted:'do not copy'},
        assertExtensionEnabled(){},getSettings:()=>({connectionMode:'custom',connection:{custom:connection}}),
        createRawPrompt:prompt=>[{role:'user',content:prompt}],SillyTavern:{getContext:()=>ctx},AbortController};
    vm.createContext(scope);vm.runInContext(source,scope);
    await scope.generateSummary('question',{maxTokens:1700});
    assert.equal(requests[0].max_tokens,1700);
    assert.equal(requests[0].unwanted,undefined);
    assert.equal(connection.maxTokens,5000);
    await scope.generateSummary('ordinary summary');
    assert.equal(requests[1].max_tokens,5000);
    await assert.rejects(scope.generateSummary('invalid',{maxTokens:0}));
});
