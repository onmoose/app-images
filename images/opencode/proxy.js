// A small reverse proxy in front of OpenCode's server. Node built-ins only.
//
// OpenCode's server always asks for a password (HTTP basic auth, user
// "opencode"), and has no switch to turn that off. moose already puts the app
// behind the box login, so a second login is only in the way. start.sh runs
// OpenCode on 127.0.0.1:4097 with a random password, and this proxy listens on
// port 4096 and sets that password on every request and every WebSocket
// upgrade. Any Authorization header the client sent is replaced, never passed
// on. The password is never logged.
//
// Responses are streamed as they arrive, never buffered: the web UI keeps an
// event stream open (/api/event), and the terminal panel uses a WebSocket.
'use strict';

const http = require('http');
const net = require('net');

const LISTEN_PORT = 4096;
const UPSTREAM_HOST = '127.0.0.1';
const UPSTREAM_PORT = 4097;

const password = process.env.OPENCODE_PASSWORD;
if (!password) {
  console.error('proxy: OPENCODE_PASSWORD is not set');
  process.exit(1);
}
const AUTH = 'Basic ' + Buffer.from('opencode:' + password).toString('base64');

// Headers that belong to one connection, not to the request (RFC 9110 7.6.1).
// Node sets its own on each side. A WebSocket upgrade keeps them, see below.
const HOP = new Set(['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'te', 'trailer', 'proxy-authorization', 'proxy-authenticate']);

// Copy raw headers (a flat [name, value, ...] list, so case and repeats stay as
// they were), drop the ones in `skip`, and drop Authorization.
function copyHeaders(raw, skip) {
  const out = [];
  for (let i = 0; i < raw.length; i += 2) {
    const name = raw[i].toLowerCase();
    if (name === 'authorization' || skip.has(name)) continue;
    out.push(raw[i], raw[i + 1]);
  }
  return out;
}

// No keep-alive to OpenCode. A kept socket that OpenCode closes after its idle
// timeout can fail the next request, and a POST is not retried. A new
// connection on loopback costs almost nothing.
const agent = new http.Agent({ keepAlive: false });

const server = http.createServer((req, res) => {
  const headers = copyHeaders(req.rawHeaders, HOP);
  headers.push('Authorization', AUTH);
  const up = http.request({
    host: UPSTREAM_HOST,
    port: UPSTREAM_PORT,
    method: req.method,
    path: req.url,
    headers,
    agent,
  });
  up.on('response', (upRes) => {
    try {
      res.writeHead(upRes.statusCode, upRes.statusMessage, copyHeaders(upRes.rawHeaders, HOP));
    } catch (err) {
      // A header Node refuses to send: answer 502, do not crash the proxy.
      console.error('proxy: bad upstream response:', err.code || err.message);
      upRes.resume();
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('OpenCode sent a response the proxy cannot pass on\n');
      return;
    }
    // Send the headers now, so an event stream starts before its first event.
    res.flushHeaders();
    upRes.pipe(res);
    upRes.on('error', () => res.destroy());
  });
  up.on('error', (err) => {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'text/plain' });
      res.end('OpenCode is not answering\n');
    } else {
      res.destroy();
    }
    console.error('proxy: upstream error:', err.code || err.message);
  });
  // The client went away (a closed tab, a dropped event stream): stop the
  // upstream request too.
  res.on('close', () => {
    if (!res.writableFinished) up.destroy();
  });
  req.on('error', () => up.destroy());
  req.pipe(up);
});

// A WebSocket (or any other) upgrade: write the request to OpenCode by hand,
// then pipe the two sockets into each other. Connection and Upgrade are kept
// here, since they are what asks for the upgrade.
server.on('upgrade', (req, socket, head) => {
  const upstream = net.connect(UPSTREAM_PORT, UPSTREAM_HOST);
  const fail = () => {
    socket.destroy();
    upstream.destroy();
  };
  socket.on('error', fail);
  upstream.on('error', (err) => {
    console.error('proxy: upstream upgrade error:', err.code || err.message);
    fail();
  });
  upstream.on('connect', () => {
    const headers = copyHeaders(req.rawHeaders, new Set(['proxy-authorization']));
    headers.push('Authorization', AUTH);
    let text = `${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`;
    for (let i = 0; i < headers.length; i += 2) text += `${headers[i]}: ${headers[i + 1]}\r\n`;
    upstream.write(text + '\r\n');
    if (head && head.length) upstream.write(head);
    socket.setNoDelay(true);
    upstream.setNoDelay(true);
    upstream.pipe(socket);
    socket.pipe(upstream);
  });
  socket.on('close', () => upstream.destroy());
  upstream.on('close', () => socket.destroy());
});

// No time limit on a request: an event stream stays open as long as the tab.
server.requestTimeout = 0;
server.on('clientError', (err, socket) => {
  if (socket.writable) socket.end('HTTP/1.1 400 Bad Request\r\n\r\n');
  else socket.destroy();
});

server.listen(LISTEN_PORT, '0.0.0.0', () => {
  console.log(`proxy: listening on 0.0.0.0:${LISTEN_PORT}, forwarding to ${UPSTREAM_HOST}:${UPSTREAM_PORT}`);
});
