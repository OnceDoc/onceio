var test = require("./lib/test");


var isStatic = function(req) {
  var reqUrl = req.url;

  for (var i = 0, l = STATICS.length; i < l; i++) {
    var staticFolder    = STATICS[i];
    var wildcardIdx     = staticFolder.indexOf('*')
    var startPos        = staticFolder.charAt(0) == '/' ? 0 : 1

    if (wildcardIdx < 0) {
      var pos = reqUrl.indexOf(staticFolder);
      if (startPos == pos) {
        return true;
      }
    } else {
      var urlPos = startPos;

      for (var j = 0, m = staticFolder.length; j < m; j++) {
        var curChar = staticFolder.charAt(j);
        var urlChar = reqUrl.charAt(urlPos);

        if (curChar == '*') {
          while (urlChar && urlChar != '/') {
            urlPos++;
            urlChar = reqUrl.charAt(urlPos) 
          }
        } else if (curChar != urlChar) {
          break;
        } else {
          urlPos++;
        }
      }

      if (j == m) {
        return true
      }
    }
  }

  return false
}

var isStaticWithSplit = function(req) {
  var reqUrl = req.url;

  for (var i = 0, l = STATICS.length; i < l; i++) {
    var staticFolder    = STATICS[i];
    var wildcardIdx     = staticFolder.indexOf('*')
    var startPos        = staticFolder.charAt(0) == '/' ? 0 : 1

    if (wildcardIdx < 0) {
      var pos = reqUrl.indexOf(staticFolder);
      if (startPos == pos) {
        return true;
      }
    } else {
      var curArr = staticFolder.split('/')
      var urlArr = req.url.split('/')
      for (var j = 0, m = curArr.length; j < m; j++) {
        var curStr = curArr[j];
        if (curStr && curStr != '*' && curStr != urlArr[startPos + j]) {
          break;
        }
      }
      if (j == m) {
        return true
      }
    }
  }

  return false
}


var STATICS = [ 'css', '/js/*', '/*/css', '*/js/' ]

test("Test compare with string", function() {
  isStatic({ url: '/css/images.png?abcdefef' })
  isStatic({ url: '/js/images/gogogogogogo.png/ok.js' })
  isStatic({ url: '/mail/css/images/gogogogogogo/ok.css' })
  isStatic({ url: '/mail/send/save/same.js' })
  isStatic({ url: '/mail/js/ok/gogo/test.js' })
});

test("Test compare with split", function() {
  isStaticWithSplit({ url: '/css/images.png?abcdefef' })
  isStaticWithSplit({ url: '/js/images/gogogogogogo.png/ok.js' })
  isStaticWithSplit({ url: '/mail/css/images/gogogogogogo/ok.css' })
  isStaticWithSplit({ url: '/mail/send/save/same.js' })
  isStaticWithSplit({ url: '/mail/js/ok/gogo/test.js' })
});
