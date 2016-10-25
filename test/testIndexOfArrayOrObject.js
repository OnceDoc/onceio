var test = require("./lib/test");

var testString   = "/a=link&b=1&c=abc&f=efg"

var testObj = {}
var testArr = []

for (var i = 0; i < 1000; i++) {
	testObj['test' + i] = i
	testArr.push('test' + i)
}


test("Test string chartAt", function() {
  testObj['test799']
});

test("Test string array", function() {
  testArr.indexOf('test799') > -1
});