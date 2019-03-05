/**
 * Created by maksim on 7/13/17.
 */
const assert = require('assert');

const helper = require('../../lib-fabric/helper');


describe('Helper', function(){

  it('_extractEnrolmentError', function(){

    const sample1 = 'Error: fabric-ca request register failed with errors [[{"code":0,"message":"Identity \'test22\' is already registered"}]]';
    const sample1Result = {"code":0,"message":"Identity 'test22' is already registered"};
    assert.deepEqual( helper._extractEnrolmentError(sample1), sample1Result);

    const sample2 = 'Error: fabric-ca request register failed with some error';
    const sample2Result = {"code":null,"message":sample2};
    assert.deepEqual( helper._extractEnrolmentError(sample2), sample2Result);

    const sample4 = 'Error: fabric-ca request register failed with [[{message = with invalid json}]]';
    const sample4Result = {"code":null,"message":"{message = with invalid json}"};
    assert.deepEqual( helper._extractEnrolmentError(sample4), sample4Result);

    const sample3 = 'Error: fabric-ca request register failed with errors [[{"code":400,"message":"Authorization failure"}]]';
    const sample3Result = {"code":400,"message":"Authorization failure"};
    assert.deepEqual( helper._extractEnrolmentError(sample3), sample3Result);

  });


});