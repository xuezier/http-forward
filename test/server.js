var HttpForwardServer = require('../src/server/HttpForward');

var server = new HttpForwardServer({socketPort: 2222});

server.install({ xuezi: 123456 });
server.listen(2223);
