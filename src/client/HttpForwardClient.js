'use strict';

var eventEmitter = require('events');
var net = require('net');
var crypto = require('crypto');
var stream = require('stream');
var http = require('http');

var HandleSocket = require('../lib/HandleSocket');

class HttpForwardClient extends eventEmitter {
  /**
   * create HttpForwardClient
   * @param {Object} params
   * @param {Number} params.port
   * @param {String} params.host
   * @param {Number} params.reconnectDelay
   * @param {Number} params.reconnectMaxRetryTimes
   */
  constructor(params) {
    super();

    this._reconnectDelay = params.reconnectDelay || 1000;
    this._reconnectMaxRetryTimes = params.reconnectMaxRetryTimes || 10;

    this.clientAuth = {
      name: crypto.randomBytes(4).toString('hex'),
      pass: crypto.randomBytes(16).toString('hex')
    };
    this.apiCode = null;

    this.ReqMap = new Map();

    this.options = params;
  }

  patch(app) {
    this.app = app;
    var self = this;
    app.use(function(req, res, next) {
      // console.log('heihei');
      var code = req.headers['Api-Code'];
      if (self.apiCode && (self.apiCode == code)) {
        return next();
      }
      res.status(403).end('apiCode error');
    });
  }

  /**
   * register client to server side
   * @param {{}} auth
   * @param {String|Number} auth.appid
   * @param {String|Number} auth.appsecret
   */
  register(auth) {
    var options = this.options;
    var self = this;
    var app = this.app;

    var connectRetryTimes = 0;
    return function open() {
      var socket = new net.Socket({ readable: true, writable: true });

      socket.connect(options, function() {
        console.log('socket connected');
      });

      socket.on('error', function(error) {
        if (error.syscall == 'connect') {
          connectRetryTimes++;
          if (connectRetryTimes <= self._reconnectMaxRetryTimes)
            setTimeout(open, self._reconnectDelay);
          else
            throw new Error('socket server connect error');
        }
      });

      socket.on('connect', function() {
        connectRetryTimes = 0;

        HandleSocket(socket);
        socket.msgInfo('auth-init', auth);

        socket.onMsgInfo('auth-error', function(err) {
          console.error(err.info);
          socket.destroy();
        });

        socket.onMsgInfo('auth-success', function(msg) {
          var code = msg.info;
          // console.log(code);
          self.apiCode = code;
        });
        socket.on('close', function() {
          console.log('tcp connect close');
          setTimeout(open, self._reconnectDelay);
        });


        socket.onMsgInfo('route', function(msg) {
          var info = msg.info;

          var req_reader = new stream.Readable();
          var req_socket = new net.Socket({
            // allowHalfOpen: true,
            /**simulate request */
            readable: true,
            writable: true
          });
          var moni_req = new http.IncomingMessage(req_socket);
          for (var key in info.data) {
            moni_req[key] = info.data[key];
          }

          self.ReqMap.set(info.req_id, moni_req);
          /**simulate response */
          var res_socket = new stream.Writable();
          var moni_res = new http.ServerResponse(moni_req);

          moni_res.assignSocket(res_socket);
          var res_buffers = [];
          res_socket._write = function(chunk, enc, next) {
            res_buffers.push(chunk);
            next();
          };

          moni_res.on('finish', function() {
            var res_data = Buffer.concat(res_buffers);
            socket.msgSuccess('route', {
              cb_id: info.req_id,
              data: res_data
            });
            // console.log(res_data + '');
            moni_res.emit('end');
          });

          app.call(app, moni_req, moni_res);
        });

        socket.onMsgInfo('route-body', function(msg) {
          var info = msg.info;
          var req_id = info.req_id;
          if (req_id && self.ReqMap.has(req_id)) {
            self.ReqMap.get(req_id).push(info.data);
          } else {
            self.ReqMap.set(req_id, info);
            // console.log('WRONG req_id2', info);
          }
        });

        socket.onMsgInfo('route-body-end', msg => {
          var info = msg.info;
          var req_id = info.req_id;
          if (req_id && self.ReqMap.has(req_id)) {
            self.ReqMap.delete(req_id);
          } else {
            // console.error('WRONG req_id1');
          }
        });
      });
    };
  }
}

module.exports = HttpForwardClient;
