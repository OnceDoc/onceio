var test = require("./lib/test");

var testObj   = {}
var testKey   = 'abc'
var testNum   = 100000000

test("Test typeof ==", function() {
  typeof testObj[testKey] == 'undefined'
}, testNum);

test("Test typeof ===", function() {
  typeof testObj[testKey] === 'undefined'
}, testNum);

test("Test === undefined", function() {
  testObj[testKey] === undefined
}, testNum);