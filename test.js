const test=require('node:test'),assert=require('node:assert');test('runtime available',()=>assert.ok(Number(process.versions.node.split('.')[0])>=18));
