var test = require("./lib/test");

var testString   = "/a=link&b=1&c=abc&f=efg"

test("Test string chartAt", function() {
  testString.charAt(0) == '/'
});

test("Test string array", function() {
  testString[0] == '/'
});



var filename  = 'testsample.png'
var path      = require('path')
var extname   = path.extname(filename)

test("Test basename", function() {
  path.basename(filename, extname)
});

test("Test substr with length", function() {
  filename.substr(0, filename.length - extname.length)
});