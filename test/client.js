'use strict';
var express = require('express');
var app = express();

var HttpForwardClient = require('../src/client/HttpForwardClient');

var client = new HttpForwardClient({ port: 2222, host: '127.0.0.1' });
client.patch(app);

app.all('/test', function(req, res, next) {
  // console.log('heiheihei/test');
  res.send('hello world');
});

app.listen(3333, client.register({ appid: 'xuezi', appsecret: '123456' }));
