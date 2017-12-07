'use strict';

var eventEmitter = require('events');
var net = require('net');
var http = require('http');
var crypto = require('crypto');

var HandleSocket = require('../lib/HandleSocket');

class HttpForwardServer extends eventEmitter {
  /**
   * create HttpForwardServer
   * @param {Object} params
   * @param {Number} params.socketPort
   */
  constructor(params) {
    super();
    this.clients = new Map();
    this.ResMap = new Map();
    this.AuthMap = new Map();
    this.ApiCodeMap = new Map();

    this._socketServer(params.socketPort);
  }

  install(params) {
    for (var key in params) {
      this.AuthMap.set(`${key}:${params[key]}`, false);
    }
  }

  _connectListener(socket) {
    var users = this.AuthMap;
    var clients = this.clients;
    var apicodes = this.ApiCodeMap;
    // console.log(socket.remoteAddress, socket.remotePort);

    HandleSocket(socket);

    socket.onMsg('auth-init', function(msg) {
      var auth = msg.info;
      var user = `${auth.appid}:${auth.appsecret}`;
      if (!users.has(user)) return socket.msgInfo('auth-error', 'wrong user');
      if (users.get(user)) return socket.msgInfo('auth-error', 'user has userd');

      socket.on('close', function() {
        console.log('tcp connect close');
        users.set(user, false);
        clients.delete(auth.appid);
      });

      var code = crypto.randomBytes(16).toString('hex').toUpperCase();
      users.set(user, code);
      apicodes.set(auth.appid, code);
      clients.set(auth.appid, socket);
      socket.msgInfo('auth-success', code);
    });
  }

  _socketServer(port) {
    this._connectListener = this._connectListener.bind(this);
    var socketServer = net.createServer(this._connectListener);

    socketServer.listen(port, () => {
      console.log('socket server ', port);
    });

    this.socketServer = socketServer;

  }



  /**
   *
   * @param {Number|Object} port
   */
  listen(port) {
    var proxy = http.createServer();

    proxy.on('request', this._requestListener.bind(this));
    proxy.listen(port);

  }

  _requestListener(request, response) {
    var self = this;
    var urls = request.url.split('/');
    var appid = urls[1];
    // console.log(appid)
    if (appid && this.clients.has(appid)) {
      var socket = this.clients.get(appid);
      var apiCode = this.ApiCodeMap.get(appid);

      var req_id = crypto.randomBytes(4).toString('hex') + crypto.randomBytes(16).toString('hex');
      request.url = request.url.replace(`/${appid}`, '');

      socket.msgInfo('route', {
        req_id: req_id,
        data: {
          httpVersionMajor: request.httpVersionMajor,
          httpVersionMinor: request.httpVersionMinor,
          httpVersion: request.httpVersion,
          complete: request.complete,
          headers: Object.assign(request.headers, {
            'Api-Code': apiCode,
          }),
          rawHeaders: request.rawHeaders,
          trailers: request.trailers,
          rawTrailers: request.rawTrailers,
          readable: request.readable,
          upgrade: request.upgrade,
          url: request.url,
          method: request.method,
        }
      });

      request.on('readable', function() {
        socket.msgInfo('route-body', {
          req_id: req_id,
          data: request.read() || null
        });
      });

      request.on('end', function() {
        socket.msgInfo('route-body-end', {
          req_id: req_id
        });
      });

      socket.onMsgSuccess('route', function(data) {
        var res = data.info;
        // console.log(data);
        if (res.cb_id) {
          if (self.ResMap.has(res.cb_id)) {
            var response = self.ResMap.get(res.cb_id);
            response.socket.end(res.data);
            // response.end();
            self.ResMap.delete(res.cb_id);
          } else {
            console.error('UNREGISTER RESPONED ID');
          }
        } else {
          console.error('NONE RESPONED ID');
        }
      });


      self.ResMap.set(req_id, response);
    } else {
      response.end('No Found Auth');
    }
  }
}

module.exports = HttpForwardServer;
