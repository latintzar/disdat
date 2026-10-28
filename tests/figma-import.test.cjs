const test = require('node:test');
const assert = require('node:assert/strict');
const {buildPlan} = require('../figma-plugin/code.js');

test('original Figma importer maps a DTCG library to typed variables', () => {
  const items = buildPlan({color:{accent:{$value:'#336699', $type:'color'}},
    space:{card:{$value:'12px', $type:'dimension'}},
    enabled:{$value:true, $type:'boolean'}});
  assert.deepEqual(items.map(x => [x.name,x.resolvedType]), [
    ['color/accent','COLOR'], ['space/card','FLOAT'], ['enabled','BOOLEAN']]);
  assert.equal(items[1].value, 12);
  assert.equal(items[2].value, true);
  assert.equal(items[0].value.r, 0.2);
});
