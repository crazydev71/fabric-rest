

const RELPATH = '/../'; // relative path to server root. Change it during file movement

const path    = require('path');
const express = require('express');
const expressEnv      = require('../lib/express-env-middleware');
const expressPromise  = require('../lib/express-promise');


module.exports = function(rootFolder, clientEnv){
  "use strict";
  clientEnv = clientEnv || {};

  if(!path.isAbsolute(rootFolder)){
    rootFolder = path.join(__dirname, RELPATH, rootFolder);
  }

  const app = express();
  app.use(expressPromise());

  // console.log('The following config will be exposed to client as env.js: ', clientEnv);
  app.get('/env.js', expressEnv(clientEnv));
  app.use( express.static(rootFolder, { index: 'index.html'}) );

  // at last - send 404
  app.use(function(req, res) {
    res.status(404).end('Not Found');
  });

  return app;
};