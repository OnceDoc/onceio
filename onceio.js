/*
* Description:  OnceIO
* Author:       Kris Zhang@OnceDoc
*/

"use strict";

//Node libraries
var fs      = require("fs");
var path    = require("path");
var qs      = require("qs");
var os      = require("os");

var http    = require("http");
var https   = require("https");

var zlib    = require('zlib');


//Open source libraries
var mime        = require("mime");
var formidable  = require("formidable");

/*
* Utility
*/
var _ = {
  //Merge object not replace object
  extend: function(tar, obj) {
    if (!obj) return tar;

    for (var key in obj) {
      var tarVal  = tar[key];
      var objVal  = obj[key];

      if (typeof tarVal == 'object' && typeof objVal == 'object') {
        _.extend(tarVal, objVal);
      } else {
        tar[key] = obj[key];
      }
    }

    return tar;
  }
};

//Shortcuts
var define = Object.defineProperty;

//Mapping
var CHARS = '0123456789abcdefghijklmnopqrstuvwxyz'.split('');



/*
change default type
*/
mime.default_type = ''


/*
* Define and Export OnceIO
*/
var OnceIO = module.exports = function(options) {

  var self = {};

  var SessionStore;

  /*****************Web module definitions*************/
  /*
  Configurations
  */
  var Settings = {
    //root folder of server
      root: process.cwd()

    //home folder of web
    , home: './'

    //http start
    //default port of http
    , port: 8054

    //default port of https
    , httpsPort:  8443
    , httpsKey:   ""
    , httpsCert:  ""

    //list files in directory
    , listDir: false
    //enable debug information output
    , debug: true
    //disable cache of template/include file (when disabled templates will be refreshed before restart)
    , templateCache: false
    //load from cache When size is smaller than fileCacheSize(css/js/images, 0 is disabled)
    , fileCacheSize: 0
    //show errors to user(displayed in response)
    , showError: true

    //default pages, only one is supported
    , defaultPage: "index.html"
    , 404:         ""

    /*
    Session timeout, in milliseconds.
    */
    , sessionTimeout: 1440000

    //session file stored here
    , sessionDir    : ''

    //session domain
    , sessionDomain : ''
    , sessionKey    : '_wsid'
    , sessionLength : 36

    //tempary upload file stored here
    , uploadDir:  os.tmpDir()
  };


  /*
  Body parser, parse the data in request body 
  when parse complete, execute the callback with response data;
  */
  var BodyParser = function(req, res, callback) {

    var receives = [];

    req.on('data', function(chunk) {
      receives.push(chunk);
    });

    req.on('end', function() {
      callback(Buffer.concat(receives).toString());
    });
  };

  /*
  Parse request with session support
  */
  var SessionKey  = Settings.sessionKey;

  var SessionAdapter = {
    init: function(req, res, cb) {
      var self    = this;
      var sidVal;
      var sidStr;

      //Get or Create sid, sid exist in the cookie, read it
      var sidVal = req.cookie[SessionKey];

      //Does session expired?
      var getSession = function(session) {
        var isValid = session && session.__lastAccessTime && (+new Date() - session.__lastAccessTime <= Settings.sessionTimeout);

        if (isValid) {
          req.session                   = session;
          req.session.__lastAccessTime  = +new Date();
          cb && cb();
        } else {
          SessionStore.del(sidVal);
          setSession();
        }
      };

      var setSession = function() {
        self.create(req);
        res.cookie(SessionKey, req.cookie[SessionKey], { domain: Settings.sessionDomain, path: '/', httponly: true });
        cb && cb();
      };

      //Sid doesn't exist, create it
      if (!sidVal || sidVal.length != Settings.sessionLength) {
        setSession();
      } else {
        SessionStore.get(sidVal, getSession);
      }
    }

    /*
    * newId()  : [Time Stamp]-[serverID][Random Chars]     //for sessionid, fixed length
    * newID(n) : [Time Stamp][serverID][Random Chars(n)]   //for userid
    */
    , newID: function(appendLen) {
      var len = CHARS.length;
      var sid = (+new Date()).toString(len);

      if (appendLen) {
        sid += Settings.serverID || '';
        for (var i = 0; i < appendLen; i++) {
          sid += CHARS[Math.random() * len | 0];
        }
      } else {
        sid = sid + '-' + (Settings.serverID || '');
        for (var i = sid.length; i < Settings.sessionLength; i++ ) {
          sid += CHARS[Math.random() * len | 0];
        }
      }

      return sid;
    }

    //Binding new sid to this session
    , create: function(req) {
      var self = this;
      req.cookie[SessionKey] = self.newID();
      req.session = { __lastAccessTime: +new Date() };
      return self;
    }

    , save: function(req, cb) {
      var self    = this;
      var session = req.session;
      var sid     = req.cookie[SessionKey];

      if (sid && session) {
        session.__lastAccessTime = +new Date();
        SessionStore.set(sid, session, cb);
      } else {
        cb && cb()
      }
    }
  };


  /*
  Parser: Functions that Filter and Handler will be called 
  */
  var Parser = function(req, res, mapper) {

    var handle = function() {
      try {
        mapper.handler(req, res);
      } catch(err) {
        res.error(err, 'Error ' + new Date().toISOString() + ' ' + req.url)
      }
    };

    //add sesion support
    var parseSession = function() {
      //add sesion support
      if (mapper.session && typeof req.session == "undefined") {
        SessionAdapter.init(req, res, handle);
      } else {
        handle();
      }
    };

    /*
    parse data in request
    */
    var parseBody = function() {
      //need to parse the request?
      if (mapper.post && typeof req.body == 'undefined') {
        //Must parser the request first, or the post data will lost;
        BodyParser(req, res, function(data) {
          var body = data;

          //handle exception
          try {
            if (mapper.post == 'json') {
              body = JSON.parse(data || '{}');
            }

            else if (mapper.post == 'qs') {
              //it's xml?
              if (data.charAt(0) == '<' && data.charAt(data.length - 1) == '>') {
                body = data;
              } else {
                body = qs.parse(data || '');
              }
            }

            else {
              body = data;
            }
          } catch(e) {
            body = data;
          }

          req.body = body;
          parseSession();
        });
      } else {
        parseSession();
      }
    };

    /*
    parse file in request, this should be at the top of the list
    */
    var parseFile = function() {
      if (mapper._before && !mapper._before(req, res)) {
        console.log('"before" function does not return true, request ended.');
        res.end('This is not a valid request');
        return
      }

      //Need to parse the file in request?
      if (mapper.file && typeof req.body == "undefined") {
        //Must parser the request first, or the post data maybe lost;
        var form = new formidable.IncomingForm();

        form.uploadDir = Settings.uploadDir;

        form.parse(req, function(err, fields, files) {
          if (err) {
            console.log(err);
            return;
          };

          //attach the parameters and files
          req.body  = fields;
          req.files = files;

          //in fact request will not be parsed again, because body is not undefined
          parseBody();
        });
      } else {
        parseBody();
      };
    };

    /*
    parse cookie in request
    */
    var parseCookies = function() {
      if (!req.cookie) {
        var cookie  = req.headers.cookie
        var cookies = {}
  
        if (cookie) {
          var cookieArr = cookie.split(';');
  
          for (var i = 0; i < cookieArr.length; i++) {
            var strCookie = cookieArr[i]
            var idx       = strCookie.indexOf('=')
            var key       = strCookie.substr(0, idx).trim()
            var val       = strCookie.substr(idx + 1).trim()
  
            idx > 0 && (cookies[key] = decodeURIComponent(val));
          }
        }
  
        req.cookies = cookies;
        req.cookie  = cookies;
      }

      parseFile();
    };

    parseCookies();
  };


  /*
  set: res.cookie(name, value, options)
  del: res.cookie(name, null);
  */
  var Cookie = function(name, value, options) {
    if (arguments.length < 2) {
      return console.log('Cookie setter ignored', name);
    }

    var self    = this
    var cookies = self.cookies = self.cookies || []
    var setStr  = name + '=' + encodeURIComponent(value || '')

    options = options || {};

    if (value === null) {
      setStr += '; expires=Thu, 01 Jan 1970 00:00:00 GMT';
    } else if (options.expires) {
      setStr += '; expires=' + (new Date(options.expires)).toGMTString();
    }

    options.path      && (setStr += '; path=' + options.path);
    options.domain    && (setStr += '; domain=' + options.domain);
    options.secure    && (setStr += '; secure');
    options.httponly  && (setStr += '; httponly');

    cookies.push(setStr);
  };


  /*
  SessionStore Interface (MemoryStore)
  - get : (sid, callback:session)
  - set : (sid, session)
  - del : (sid)
  session object: {
    sid: {
      ....
      __lastAccessTime: dateObject
    }
  }
  */
  var MemoryStore = (function() {

    var list;

    //force update session in list, convert to big int
    //get session in list, if undefined create new one
    var get = function(sid, cb) {
      !list && init();
      !list[sid] && (list[sid] = {});
      cb && cb(list[sid]);
    };

    var set = function(sid, session, cb) {
      !list && init();
      list[sid] = session;
      cb && cb();
    };

    //remove a session from list
    var del = function(sid, cb) {
      delete list[sid];
      cb && cb();
    };

    /*
    Session clear handler
    */
    var clearHandler = function() {
      for (var sid in list) {
        var session = list[sid];
        var isValid = session.__lastAccessTime && ((new Date() - session.__lastAccessTime) || 0 <= Settings.sessionTimeout * 2);
        !isValid && del(sid);
      }
    };

    var init = function() {
      list = {};
      setInterval(clearHandler, Settings.sessionTimeout * 4);      
    };

    return {
        get     : get
      , set     : set
      , del     : del
    }

  })();

  var FileStore = (function() {

    var getPath = function(sid) {
      return path.join(Settings.sessionDir, sid);
    };

    var del = function(sid, cb) {
      fs.unlink(getPath(sid), function(err) {
        err && console.log("Unlink session file err", err);
        cb  && cb(err)
      });
    };

    var set = function(sid, session, cb) {
      fs.writeFile(getPath(sid), JSON.stringify(session), function(err) {
        if (err) {
          console.error(err);
        }
        cb && cb(err)
      });
    };

    var get = function(sid, cb) {
      var session = {};
      fs.readFile(getPath(sid), function(err, data) {
        if (err) {
          console.log(err);
          cb && cb(session);
          return;
        }

        try {
          session = JSON.parse(data);
        } catch (e) {
          console.log(e);
        }
        cb && cb(session);
      });
    };

    /*
    Clear the sessions, you should do it manually somewhere, etc:
    setInterval(websvr.SessionStore.clear, 200 * 60 * 1000)
    */
    var clear = function() {
      fs.readdir(Settings.sessionDir, function(err, files) {
        if (err) return console.log(err);

        //Delete these sessions that created very very long ago
        var expire = +new Date() - Settings.sessionTimeout * 24;

        for (var i = 0; i < files.length; i++) {
          var file  = files[i]
          var idx   = file.indexOf('-')

          if (file.length == Settings.sessionLength && idx > 0) {
            var stamp = parseInt(file.substr(0, idx), CHARS.length);
            //remove the expired session
            stamp && stamp < expire && del(file);
          }
        }
      });
    };

    return {
        get   : get
      , set   : set
      , del   : del
      , clear : clear
    }

  })();

  /*
  Mapper: Used for Filter & Handler,
  expression: required parameter
  handler:    required parameter
  options:    optional parameters
  */
  var Mapper = function(expression, handler, options) {
    var self = this;

    self.expression = expression;
    self.handler = handler;

    typeof options == 'object'
      ? self.extend(options)
      : (self.post = options);
  };

  Mapper.prototype = {
    /*
    Does this mapper matched this request?
    Filter and Handler doesn't have the same matched rules when you passing a string
    Filter  : Match any section of the request url,          e.g., websvr.filter(".svr", cb);
    Handler : Match from the begining but it can bypass '/', e.g., websvr.handle("home/login", cb) or websvr.handle("/home/login")
    */
    match: function(req) {
      var self        = this
      var reqUrl      = req.url
      var expression  = self.expression

      if (typeof self.method != 'undefined' && self.method != req.method) {
        return false
      }
 
      //No expression? It's a general filter mapper
      if (!expression) return true;

      switch (expression.constructor) {
        //String handler must start with home path, but it can bypass '/'
        case String:
          return self.matchString(req, expression);
        case RegExp: return expression.test(reqUrl);
        case Array:
          for (var i = 0, l = expression.length; i < l; i++) {
            if (self.matchString(req, expression[i])) {
              return true;
            }
          }
          return false;
      }

      return false;
    },

    /*
    Handle string expression like: /login/:username  or /userinfo/
    */
    matchString: function(req, expression) {
      var self    = this
      var reqUrl  = req.url
      var isLoose = self.mode == 'loose'

      //Match all the request
      if (expression == '/' && isLoose) {
        return true
      }

      //Pure string without params
      else if (expression.indexOf('/:') < 0) {
        var idx     = reqUrl.indexOf(expression)
        var isMatch = false

        if ((idx == 0 || idx == 1)) {
          var lastChar = reqUrl.charAt(idx + expression.length)

          /*
          mode=>loose: matche part of the url
          request: http://domain.com/user/kris
            app.get('/user', handler)   //not match
            app.url('/user', handler)   //match
          */
          if (isLoose) {
            isMatch = lastChar == '' || lastChar == '/' || lastChar == '?';
          } else {
            isMatch = lastChar == '' || lastChar == '?';
          }
        }

        return isMatch;
      //Handle and pickup params
      } else {
        var params = this.parseUrl(expression, reqUrl);
        params && _.extend(req.params, params);
        return params;
      }
    },

    /*
    * Pickup the params in the request url
    * expression = /home/:key/:pager
    *   /home/JavaScript/1 => { id: 'JavaScript', pager: '1' }
    *   /key/JavaScript/1  => false 
    * expression = /home/:fileUrl$
    *   /home/JavaScript/what/ever/ => { fileUrl:'JavaScript/what/ever/' }
    */
    parseUrl: function(expression, reqUrl) {
      //Remove the params in querystring
      var self  = this;
      var idx   = reqUrl.indexOf('?');
      idx > 0 && (reqUrl = reqUrl.substr(0, idx));

      var parts   = expression.split('/');
      var urls    = reqUrl.split('/');
      var isLoose = self.mode == 'loose'


      var start   = expression.charAt(0) === '/' ? 0 : 1;
      var params  = {};
      //match the begining of the url or the whole url
      var maxLen  = parts.length > urls.length ? parts.length : urls.length;
      var len     = isLoose ? parts.length : maxLen;

      //console.log(expression, self.mode, reqUrl, parts, urls, len)

      for (var i = 0; i < len; i++) {
        var part  = parts[i];
        var param = urls[i + start];

        if (part && part.charAt(0) === ':') {
          var paramName   = part.substr(1);
          /*
          $ means match to the end of the url and it will irgnore the rest
          /file/view/:fileUrl$
          */
          var isWholeMatch  = part.charAt(part.length - 1) === '$';

          if (isWholeMatch) {
            paramName = paramName.substr(0, paramName.length - 1);
            param = urls.slice(i + start, urls.length).join('/');
          }

          try {
            params[paramName] = decodeURIComponent(param || '');
          } catch(err) {
            params[paramName] = param;
          }

          if (isWholeMatch) {
            return params;
          }
        } else if (part != param) {
          return false;
        }
      }

      return params;
    },

    /*
    Add optional parameters on current mapper
    i.e:
    session:  boolean
    file:     boolean
    parse:    boolean
    */
    extend: function(options) {
      for(var key in options) {
        this[key] = options[key]
      }
    },

    /*
    Something need to be done first: i.e:
    check the file size and extension before uploading files;
    check the content-length before receiving a post json
    */
    before: function(func) {
      func && (this._before = func)
    }
  };

  /*
  Http Filter: Execute all the rules that matched,
  Filter will be always called before a handler. 
  */
  var Filter = {
    //filter list
    filters: []
    
    /*
    filter: add a new filter
    expression: string/regexp [optional]
    handler:    function      [required]
    options:    object        [optional]
    */
    , filter: function(expression, handler, options) {
      //The first parameter is Function => (handler, options)
      if (expression.constructor == Function) {
        options = handler;
        handler = expression;
        expression = null;
      }

      var mapper = new Mapper(expression, handler, options);
      mapper.mode = mapper.mode || 'loose';
      Filter.filters.push(mapper);

      return mapper;
    }

    //Session: parse the session
    , session: function(expression, handler, options) {
      var mapper = this.filter(expression, handler, options);
      mapper.session = true;
      return mapper;
    }

    /*
    file receiver: it's a specfic filter,
    this filter should be always at the top of the filter list
    */
    , file: function(expression, handler, options) {
      var mapper = new Mapper(expression, handler, options);
      mapper.file = true;

      typeof mapper.session == 'undefined' && (mapper.session = true)

      //insert at the top of the filter list
      Filter.filters.splice(0, 0, mapper);

      return mapper;
    }
  };

  /*
  Filter Chain
  */
  var FilterChain = function(cb, req, res) {
    var self = this;

    self.idx = 0;
    self.cb = cb;

    self.req = req;
    self.res = res;
  };

  FilterChain.prototype = {
    next: function() {
      var self = this
      var req  = self.req
      var res  = self.res

      var mapper = Filter.filters[self.idx++];

      //filter is complete, execute callback;
      if (!mapper) return self.cb && self.cb();

      /*
      If not Matched go to next filter
      If matched need to execute the req.next() in callback handler,
      e.g:
      webSvr.filter(/expression/, function(req, res) {
        //filter actions
        req.next(req, res);
      }, options);
      */
      if (mapper.match(req)) {
        console.log("Filter matched", self.idx, mapper.expression, req.url);

        //filter matched, parse the request and then execute it
        Parser(req, res, mapper);
      } else {
        //filter not matched, validate next filter
        self.next();
      }
    }
  };

  /*
  Http Handler: Execute and returned when when first matched;
  At the same time only one Handler will be called;
  */
  var Handler = {
    handlers: []
    /*
    url: add a new handler
    expression: string/regexp [required]
    handler:    [many types]  [required]
    options:    object        [optional]
    */
    , url: function(expression, handler, options) {
      if (!expression) {
        console.log('Url expression ignored');
      } else {
        var mapper = new Mapper(expression, handler, options);
        mapper.mode = mapper.mode || 'loose';
        Handler.handlers.push(mapper);
      }
      return self;
    }

    , get: function(expression, handler, options) {
      if (!expression) {
        console.log('Get expression ignored');
      } else {
        var mapper = new Mapper(expression, handler, options);
        mapper.method = 'GET';
        Handler.handlers.push(mapper);
      }
      return self;
    }

    /*
    post default is loose mode
    */
    , post: function(expression, handler, options) {
      if (expression && handler) {
        var optionType = typeof options

        if (optionType == 'undefined') {
          options = 'qs';
        } else if (optionType == 'object' && !options.post) {
          options.post = 'qs';
        }

        var mapper = new Mapper(expression, handler, options);
        mapper.mode   = mapper.mode || 'loose';
        mapper.method = 'POST';
        Handler.handlers.push(mapper);
      }
      return self;
    }

    /*
    json default is loose mode
    */
    , json: function(expression, handler, options) {
      if (expression && handler) {
        var optionType = typeof options

        if (optionType == 'undefined') {
          options = 'json'
        } else if (optionType == 'object' && !options.post) {
          options.post = 'json'
        }
        return this.url(expression, handler, options);
      }
      return self;
    }

    , handle: function(req, res) {
      //flag: is matched?
      for(var i = 0, len = Handler.handlers.length; i < len ; i++) {

        var mapper = Handler.handlers[i];
        //This is handler match
        if (mapper.match(req)) {

          console.log("Handler matched", i, mapper.expression, req.url);

          var handler = mapper.handler,
              type    = handler.constructor.name;

          switch(type) {
            //function: treated it as custom function handler
            case "Function":
              Parser(req, res, mapper);
              break;

            //string: treated it as content
            case "String":
              res.writeHead(200, { "Content-Type": "text/html" });
              res.end(handler);
              break;

            //array: treated it as a file.
            case "Array":
              res.sendFile(handler[0]);
              break;
          }
          return true;
        }
      }

      return false;

    }   //end of handle
  };

  /*
  ListDir: List all the files in a directory
  */
  var ListDir = (function() {

    var urlFormat = function(url) {
      url = url.replace(/\\/g,'/');
      url = url.replace(/ /g,'%20');
      return url;
    };

    //Align to right
    var date = function(date) {
      var d = date.getFullYear() 
        + '-' + (date.getMonth() + 1)
        + '-' + (date.getDay() + 1)
        + " " + date.toLocaleTimeString();
      return "                ".substring(0, 20 - d.length) + d;
    };

    //Align to left
    var size = function(num) {
      return num + "                ".substring(0, 12 - String(num).length);
    };

    //Create an anchor
    var anchor = function(txt, url) {
      url = url ? url : "/";
      return '<a href="' + url + '">' + txt + "</a>";
    };

    var listDir = {
      //List all the files in a directory
      list: function(req, res, dir) {
        var url = req.url,
            cur = 0,
            len = 0;

        var listBegin = function() {
          res.writeHead(200, {"Content-Type": "text/html"});
          res.write("<h2>http://" + req.headers.host + url + "</h2><hr/>");
          res.write("<pre>");
          res.write(anchor("[To Parent Directory]", url.substr(0, url.lastIndexOf('/'))) + "\r\n\r\n");
        };

        var listEnd = function() {
          res.write("</pre><hr/>");
          res.end("<h5>Count: " + len + "</h5>");
        };

        listBegin();

        fs.readdir(dir, function(err, files) {
          if (err) {
            listEnd();
            console.log(err);
            return;
          }

          len = files.length;

          for(var idx = 0; idx < len; idx++) {
            //Persistent the idx before make the sync process
            (function(idx) {
              var filePath = path.join(dir, files[idx]),
                  fileUrl = urlFormat(path.join(url, files[idx]));

              fs.stat(filePath, function(err, stat) {
                cur++;

                if (err) {
                  console.log(err);
                }else{
                  res.write(
                    date(stat.mtime)
                    + "\t" + size(stat.size)
                    + anchor(files[idx], fileUrl)
                    + "\r\n"
                  );
                }

                (cur == len) && listEnd();
              });
            })(idx);
          }

          (len == 0) && listEnd();
        });
      }
    };

    return listDir;
  }());

  /*
  * Template Engine
  */
  var Template = (function() {

    //Caching of template files.
    var tmplCachePool   = {}
    var includeString   = '<!--#include="'
    var includeRegExp   = /<!--#include="[\w\.\\\/]+"-->/g
    var includeBeginLen = 14
    var includeAfterLen = 4

    var defaultModel    = {}

    /*
    get a file
    */
    var getFile = function(filePath, cb, res) {
      var tmplCache = res._template[filePath];
      var tmplPath

      /*
      It's html or tmpl path
      */
      if (typeof tmplCache != 'undefined') {
        if ( tmplCache.charAt(0) == '<'
          && tmplCache.charAt(tmplCache.length - 1) == '>') {
          return tmplCache;
        } else if (!tmplCache) {
          return tmplCache;
        } else {
          tmplPath = tmplCache;
        }
      } else {
        tmplPath = filePath;
      }

      var module    = getModule(tmplPath);

      if (module) {
        tmplPath    = path.join(module.home, module.file);
      } else {
        var homeDir = tmplPath.charAt(0) == '/' ? Settings.home : (res.home || Settings.home);
        tmplPath    = path.join(homeDir, tmplPath);
      }

      //if template cache enabled, get from cache pool directly
      var cachedTemplate  = tmplCachePool[tmplPath];
      var hasInclude      = cachedTemplate && cachedTemplate.indexOf(includeString) > -1

      var updateInclude = function(err, tmpl) {
        if (err) {
          console.error(err, tmplPath);
          cb && cb('');
          return ''
        } else if (res) {
          tmpl = tmpl.toString();
          //update cache before replace the include
          if (!Settings.templateCache || typeof cachedTemplate == 'undefined') {
            console.log('Update template cache', tmplPath);
            tmplCachePool[tmplPath] = tmpl;
          }

          tmpl = getInclude(tmpl, cb, res);
          return tmpl;
        }
      };

      /*
      templateCache: 
      */
      if (Settings.templateCache && cachedTemplate) {
        console.log('Get from cache:', tmplPath);
        !hasInclude && cb && cb(cachedTemplate);
      } else {
        console.log('Get from file:', tmplPath);
        fs.readFile(tmplPath, updateInclude);
      }

      if (hasInclude) {
        return updateInclude(null, cachedTemplate);
      }
      return cachedTemplate;
    };

    /*
    find and update all the include files and update the cache
    */
    var getInclude = function(tmpl, cb, res) {
      tmpl = (tmpl || '').replace(includeRegExp, function(fileStr) {
        var includeFile = fileStr.substring(includeBeginLen, fileStr.length - includeAfterLen);
        var tmplCache   = getFile(includeFile, null, res);
        return tmplCache || fileStr;
        //return tmplCachePool[includeFile] || fileStr;
      });

      cb && cb (tmpl)
      return tmpl
    };

    /*
    render error
    */
    var error = function(err, customErrorMsg) {
      var res = this

      var errorMsg
        = (customErrorMsg || '')
        + '\n'
        + err.stack || err.message || 'unknow error'
        + '\n'
        ;

      console.error(errorMsg);

      if (Settings.showError) {
        res.end('<pre>' + errorMsg.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</pre>')
      } else {
        res.end()
      }
    };


    return {
        //render templates
        render: function(tmplUrl, _model, isRawTmpl) {
          var res = this
          var len = arguments.length
          var idx
          var ext

          /*
          format
          */
          len < 1 && (tmplUrl = {});

          if (len < 2) {
            if (typeof tmplUrl == 'object') {
              _model   = tmplUrl;
              /*
              * remove the first '/' make it as related path
              */
              tmplUrl = res.req.url.substr(1);

              idx = tmplUrl.indexOf('?');
              idx > -1 && (tmplUrl = tmplUrl.substr(0, idx));
            } else {
              _model   = {};
            }
          }

          var idx = tmplUrl.lastIndexOf('.')
          if (idx > 0) {
            ext = tmplUrl.substr(idx + 1)
          }

          /*
          merge model
          */
          var model = Object.create(defaultModel);
          _.extend(model, res._model);
          _.extend(model, _model);


          /*
          response
          */
          var render = function(chrunk) {
            try {
              var html = Template.getEngine(ext)(chrunk, model);
              res.end(html);
            } catch(err) {
              /*
              refer: https://code.google.com/p/v8/issues/detail?id=1914
              at eval (eval at <anonymous> (unknown source), <anonymous>:2:8)
              */
              var errStack  = err.stack || ''
              var lineStr   = '<anonymous>:'
              var idx       = errStack.indexOf(lineStr)
              var errmsg    = res.req.url + '@' + tmplUrl.substr(0, 400)

              if (idx > 0) {
                errStack  = errStack.substr(idx)
                errStack  = errStack.substr(0, errStack.indexOf(')'))
                var pos   = errStack.substring(lineStr.length)
                pos = pos.substring(pos.indexOf(':') + 1, errStack.length - 1)
                pos = parseInt(pos)

                if (pos) {
                  var strFn   = (chrunk || '').toString()
                  var errStr  = strFn.substring(pos - 10, pos + 100)
                  errmsg += ':' + errStack + '\n    ' + errStr
                }
              }

              res.error(err, errmsg)
            }
          };

          if (isRawTmpl) {
            getInclude(tmplUrl, render, res);
          } else {
            getFile(tmplUrl, render, res);
          }
        }
      , renderRaw: function(rawTmpl, model) {
          this.render(rawTmpl, model, true);
        }
      , error: error
      , engines: {
          '' : function(chrunk, model) {
              //default engines
              var compiler  = require("dot").compile;
              var tmplFn    = compiler(chrunk);
              return tmplFn(model);
          }
        }
      , setEngine: function(extname, _engineFunc) {
          var self = this;
          if (arguments.length < 2) {
            self.engines[''] = _engineFunc
            return
          }

          if (extname.charAt('0') == '.') {
            extname = extname.substr(1)
          }

          self.engines[extname] = _engineFunc;
        }
      , getEngine: function(extname) {
          var self = this;
          return self.engines[extname || ''] || self.engines['']
        }
      , _model  : defaultModel
      , clear: function() {
          for (var tmpl in tmplCachePool) {
            delete tmplCachePool[tmpl];
          }

          for (var file in fileCachePool) {
            delete fileCachePool[file];
          }

          var preloadList = Template.preloadList;
          for (var i = 0; i < preloadList.length; i++) {
            var preloadArgs = preloadList[i];
            Template.preloadModule.apply(this, preloadArgs);
          }
        }
      , preloadList: []
      , preloadModule: function(dirname, extname) {
          var module  = getModule(dirname);
          var home    = module ? module.home : path.join(Settings.home, dirname);

          console.log('Preload', home, extname);

          fs.readdir(home, function(err, files) {
            if (err) {
              console.error(err, home);
              return
            }

            for (var i = 0; i < files.length; i++) {
              var fileName = files[i];
              var extIdx   = fileName.indexOf(extname);
              if (extIdx === (fileName.length - extname.length) && extIdx > 0) {
                getFile(fileName, null, { home: home, _template: {} });
              }
            }
          })
        }
      , preload: function(dirname, extname) {
          var preloadArgs = Array.prototype.slice.call(arguments)
          Template.preloadList.push(preloadArgs);
          Template.preloadModule.apply(this, preloadArgs);
        }
      , tmplCachePool: tmplCachePool
    }
  }());

  var fileCachePool = {};

  /*****************Web initial codes*************/
  var fileHandler = function(req, res) {

    var url       = req.url
    var hasQuery  = url.indexOf("?")

    //fs.stat can't recognize the file name with querystring;
    url = hasQuery > 0 ? url.substring(0, hasQuery) : url;

    var fullPath;

    /*
    remove redirect module prefix
    res.prefix  = '/moduleName'
    res.home    = './mod/moduleFolder/web'
    http://domain.com/moduleName/js/your.js => ./mod/moduleFolder/web/js/your.js
    */
    if (res.home && res.prefix) {
      fullPath = path.join(res.home, url.replace(res.prefix, ''));
    } else {
      fullPath = path.join(res.home || Settings.home, url);
    }

    //Handle path
    var handlePath = function(phyPath) {
      var cachedFile = fileCachePool[phyPath]

      if (cachedFile) {

        if (cachedFile == 404) {
          self.write404(res)
          return
        }

        res.statusCode = 200;
        res.type(phyPath);
        res.setHeader('Etag', cachedFile.ino || '');
        res.setHeader('Last-Modified', cachedFile.mtime.toUTCString());

        // The file is modified
        var cacheTime = new Date(req.headers['if-modified-since'] || 1);

        if (Settings.fileCacheSize && Math.abs(cachedFile.mtime - cacheTime) < 1000) {
          res.statusCode = 304;
          res.end();
          return;
        }

        var acceptEncoding = req.headers['accept-encoding'] || ''

        if (acceptEncoding.indexOf('gzip') > -1) {
          res.setHeader('Content-Encoding', 'gzip');
          res.setHeader('Content-Length', cachedFile.gzip.length);
          res.end(cachedFile.gzip, 'binary');
        } else {
          res.setHeader('Content-Length', cachedFile.data.length);
          res.end(cachedFile.data, "binary");
        }

        console.log('Get file from cache:', phyPath);

        return
      }

      fs.stat(phyPath, function(err, stat) {

        //Consider as file not found
        if (err) {
          console.log(phyPath, 'not found')
          self.write404(res);

          if (Settings.fileCacheSize) {
            fileCachePool[phyPath] = 404
          }
          return
        }

        //Is file? Open this file and send to client.
        if (stat.isFile()) {
          // "If-modified-since" undefined, mark it as 1970-01-01 0:0:0
          var cacheTime = new Date(req.headers["if-modified-since"] || 1);

          // The file is modified
          if (Math.abs(stat.mtime - cacheTime) < 1000) {
            res.writeHead(304);
            res.end();

          // If file cache is enabled
          } else if (Settings.fileCacheSize > stat.size) {

            writeFile(res, phyPath, function(err, data) {
              if (err) {
                return
              }

              zlib.gzip(data, function(err, decoded) {
                if (err) {
                  return;
                }

                fileCachePool[phyPath] = {
                    size  : stat.size
                  , data  : data
                  , gzip  : decoded
                  , ino   : stat.ino
                  , mtime : stat.mtime
                }
              });
            });

          // Else send "not modifed"
          } else {

            res.setHeader("Last-Modified", stat.mtime.toUTCString());
            writeFile(res, phyPath);
          }
        }

        //Is Directory?
        else if (stat.isDirectory()) {
          handleDefault(phyPath);
        }

        //Or write the 404 pages
        else {
          self.write404(res);
        }

      });
    };

    //List all the files and folders.
    var handleDir = function(dirPath) {
      Settings.listDir
        ? ListDir.list(req, res, dirPath)
        : self.write403(res);
    };

    //Handle default page
    var handleDefault = function(dirPath) {
      var defaultPage = Settings.defaultPage;

      if (defaultPage) {
        var defaultPath = path.join(dirPath, defaultPage);

        fs.exists(defaultPath, function(exists) {
          //If page exists hanle it again
          if (exists) {
            //In order to make it as a dir path for loading static resources
            if (url[url.length - 1] != '/') {
              return res.redirect(url + '/');
            }

            handlePath(defaultPath);
          //If page doesn't exist hanlde the dir again
          } else {
            handleDir(dirPath);
          }
        });
      } else {
        handleDir(dirPath);
      }
    };

    handlePath(fullPath);
  }

  /*
  Response may be shutdown when do the filter, in order not to cause exception,
  Rewrite the write/writeHead functionalities
  */
  var ignoreAfterSent = function() {
    console.log("Response is already end, response.write ignored!")
  };

  var endHandler = function() {
    var res   = this;
    var req   = res.req;
    var args  = arguments;

    //If Content-Type is undefined, using text/html as default
    if (!res.headersSent) {
      !res.getHeader('Content-Type')    && res.setHeader('Content-Type', 'text/html; charset=' + (res.charset || 'utf-8'));
      res.cookies && res.cookies.length && res.setHeader('Set-Cookie', res.cookies);
    }

    //Update session when resonse.end is executed
    if (req.session) {
      SessionAdapter.save(req, function(err) {
        res.endFn.apply(res, args);
        res.write = res.writeHead = res.setHeader = ignoreAfterSent;
      });
    } else {
      res.endFn.apply(res, args);
      res.write = res.writeHead   = res.setHeader = ignoreAfterSent;
    }
  }

  //send file to response
  var sendFileHandler = function(filePath) {
    var res = this;
    var homeDir = res.home || Settings.home;
    writeFile(res, path.join(homeDir, filePath));
  }

  //301/302 : move permanently
  var redirectHandler = function(url, status) {
    var res = this;
    res.statusCode = status || 302;
    res.setHeader('Location', url);
    res.end();
  }

  //set content-type
  var typeHandler = function(type) {
    var res = this;
    if(type && !res.headersSent) {
      res.getHeader('Content-Type') && res.removeHeader("Content-Type");
      res.setHeader('Content-Type', (mime.lookup(type) || 'text/plain') + '; charset=' + (res.charset || 'utf-8'));
    }
  }

  //cache control header
  var cacheHandler = function(states, second) {
    var res = this;
    var req = res.req;
    var len = arguments.length

    if (states && states.mtime && states.ino)  {
      res.setHeader('Etag', states.ino);
      res.setHeader('Last-Modified', states.mtime.toUTCString());

      if (len < 2) {
        return false;
      }
    }

    if (len < 2) {
      second = states;
    }

    var second  = parseInt(states) || 0;
    res.getHeader('Cache-Control') && res.removeHeader("Cache-Control");
    res.setHeader('Cache-Control', 'max-age=' + second);

    return false;
  }

  var isCached = function(states) {
    var req = this;

    // using client cache
    var cacheTime = new Date(req.headers['if-modified-since'] || 1);
    if (Math.abs(states.mtime - cacheTime) < 1000) {
      return true;
    }

    return false;
  }

  var STATICS = [];

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

  self.static = function(prefixUrl) {
    if (STATICS.indexOf(prefixUrl) < 0) {
      STATICS.push(prefixUrl)
    }
  };


  /*
  send sth
  send(304)
  send('hellow world')
  send(200, 'hello world')
  send('json', { go, go, go })
  send({ ok: 1 })
  send('html', '<html></html>')
  */
  var sendHandler = function(type, content) {
    var res = this;

    if (arguments.length < 2) {
      if (typeof type == 'number') {
        res.statusCode = type;
        res.end();
        return
      }

      content = type;
      type    = null;
    }

    if (typeof content == 'object') {
      content = JSON.stringify(content);
      type = type || 'json';
    }

    if (type) {
      typeof type == 'number'
        ? (res.statusCode = type)
        : res.type(type);
    }

    res.end(content || '');
  }

  var setModel = function(name, model) {
    // this equal to res or app
    var self = this;

    if (arguments.length < 2) {
      _.extend(self._model, name);
    } else {
      var obj   = {};
      obj[name] = model;
      _.extend(self._model, obj);
    }
  }

  var setTemplate = function(tmpl) {
    var res = this;
    _.extend(res._template, tmpl);
  }

  var requestHandler = function(req, res) {
    //Make request accessible in response object
    res.req       = req;
    res.endFn     = res.end;
    //New functionalities
    res.end       = endHandler;
    res.sendFile  = sendFileHandler;
    res.redirect  = redirectHandler;
    res.type      = typeHandler;
    res.send      = sendHandler;
    res.cache     = cacheHandler;
    res.cookie    = Cookie;

    //render template objects
    res.error     = Template.error;
    res.render    = Template.render;
    res.renderRaw = Template.renderRaw;

    //default model
    res._model    = {};
    res._template = {};
    res.model     = setModel;
    res.template  = setTemplate;

    //params in the matched url
    req.params  = {};
    req.param   = req.params;
    req.cached  = isCached;


    /*
    handle module
    */
    var module = getModule(req.url);
    if (module) {
      res.home    = module.home;
      res.prefix  = module.name;
    }

    /*
    handle static files
    */
    if (isStatic(req)) {
      console.log('Static', req.url);
      fileHandler(req, res);
      return
    }


    //initial httprequest
    var filterChain = new FilterChain(function() {

      //if handler not match, send the request
      !Handler.handle(req, res) && fileHandler(req, res);

    }, req, res);

    //Hook FilterChain object on the request
    req.filter = filterChain;

    //Parse query string
    var idx = req.url.indexOf('?');
    req.query = idx > 0 ? qs.parse(req.url.substr(idx + 1)) : {};

    //Handle the first filter
    req.filter.next();
  };

  var writeFile = function(res, fullPath, cb) {
    fs.readFile(fullPath, function(err, data) {
      if (err) {
        cb && cb(err)
        console.log(err);
        return;
      }

      cb && cb(null, data);

      res.type(fullPath);
      res.setHeader('Content-Length', data.length);
      res.writeHead(200);
      res.end(data, "binary");
    });
  };

  //API have function chain
  //Mapper
  self.parseUrl = Mapper.prototype.parseUrl;

  //Server ID
  self.newID    = SessionAdapter.newID;

  //Filter
  self.use      = Filter.filter;
  self.filter   = Filter.filter;
  self.session  = Filter.session;
  self.file     = Filter.file;

  //Handler
  self.url      = Handler.url;
  self.get      = Handler.get;
  self.handle   = Handler.get;
  self.handler  = Handler.get;
  self.post     = Handler.post;
  self.json     = Handler.json;
  self.settings = Settings;

  //Template
  self.engine   = Template.setEngine;
  self.engines  = Template.engines;
  self._model   = Template._model;
  self.MODEL    = Template._model;
  self.model    = setModel;
  self.clear    = Template.clear;
  //preload templates
  self.preload  = Template.preload;
  self.pre      = Template.preload;


  //static file cache pool & tmplate cache ppol
  self.fileCachePool = fileCachePool;
  self.tmplCachePool = Template.tmplCachePool;


  self.write403 = function(res) {
    res.writeHead(403, {"Content-Type": "text/html"});
    res.end("Access forbidden!");

    return self;
  };

  self.write404 = function(res) {
    var tmpl404 = Settings["404"];

    res.writeHead(404, {"Content-Type": "text/html"});

    tmpl404
      ? res.render(tmpl404, null)
      : res.end("File not found!");

    return self;
  };

  //模块汇总
  var MODULES = {};

  /*
  begin with '/' e.g "path.tmpl", find the file from system web folder or find from module folder
  */
  var getModule = function(url) {
    var homeDir
    var modStr  = url

    if (modStr.charAt(0) == '/') {
      modStr    = modStr.substr(1);
    }

    var tmpIdx = modStr.indexOf('?');
    if (tmpIdx > -1) {
      modStr = modStr.substr(0, tmpIdx);
    }

    var modIdx  = modStr.indexOf('/');
    //If the begin with regiested modules, then
    var modName = modIdx > -1
      ? modName = modStr.substr(0, modIdx)
      : modName = modStr;

    var modHome = MODULES[modName];

    if (modHome) {
      return {
          name: modName
        , home: modHome
        , file: modStr.substr(modIdx)
      }
    }
  };

  //module/ addon redirect
  self.mod = function(name, home) {
    if (name.charAt(0) == '/') {
      name = name.substr(1)
      console.log('Module renamed to ', name);
    }

    if (MODULES[name]) {
      console.error('Module already registered, it will be override', name, home)
    }

    MODULES[name] = home;
  };

  self.running = false;

  //start http server
  self.start = function() {

    if (self.running) {
      console.log('Already running, ignored');
      return self;
    }

    //Create http server: Enable by default
    if (Settings.port) {
      var port = Settings.port;

      var httpSvr = self.httpSvr || http.createServer(requestHandler);
      httpSvr.listen(port);

      console.log("Http server running at"
        ,"home:", Settings.home
        ,"port:", port
      );

      self.httpSvr = httpSvr;
    }

    //Create https server: Disable by default
    if ( Settings.httpsPort
      && Settings.httpsKey
      && Settings.httpsCert) {

      var httpsPort = Settings.httpsPort;

      var httpsSvr = self.httpsSvr || https.createServer({
        key:  Settings.httpsKey,
        cert: Settings.httpsCert
      }, requestHandler);

      httpsSvr.listen(httpsPort);

      console.log("Https server running at"
        ,"home:", Settings.home
        ,"port:", httpsPort
      );

      self.httpsSvr = httpsSvr;
    }

    self.running = true;

    return self;
  };

  //stop http server
  self.stop = function() {
    self.httpSvr  && self.httpSvr.close();
    self.httpsSvr && self.httpsSvr.close();
    self.running = false;

    return self;
  };

  //init
  self.init = function() {
    //Update the default value of Settings
    _.extend(Settings, options);

    SessionStore = Settings.sessionDir ? FileStore : MemoryStore;

    //Start by default
    self.start();

    return self;
  };

  //property: filters & handlers
  define(self, 'filters', {
    get: function() { 
      return Filter.filters
    },
    set: function(filters) {
      Filter.filters = filters;
    }
  });

  define(self, 'handlers', {
    get: function() {
      return Handler.handlers;
    },
    set: function(handlers) {
      Handler.handlers = handlers;
    }
  });

  define(self, 'sessionStore', {
    get: function() {
      return SessionStore;
    },
    set: function(sessionStore) {
      if (sessionStore && sessionStore.get && sessionStore.set && sessionStore.del) {
        SessionStore = sessionStore;
      } else {
        console.log('Your session storage do not have interface: get/set/del');
      }
    }
  });

  //init
  self.init();

  return self;

};
