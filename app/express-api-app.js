/**
 * Created by maksim on 7/13/17.
 */
'use strict';
const RELPATH = '/../'; // relative path to server root. Change it during file movement
const util = require('util');
const path = require('path');

const log4js = require('log4js');
const logger = log4js.getLogger('WebApp');

const express         = require('express');
// const session      = require('express-session');
// const cookieParser = require('cookie-parser');
const bodyParser      = require('body-parser');
const expressJWT      = require('express-jwt');
const cors            = require('cors');
const bearerToken     = require('express-bearer-token');
const expressPromise  = require('../lib/express-promise');
const expressEnv      = require('../lib/express-env-middleware');

const jwt   = require('jsonwebtoken');
const tools = require('../lib/tools');
const hfc   = require('../lib-fabric/hfc');
const networkConfig = hfc.getConfigSetting('network-config');

const helper        = require('../lib-fabric/helper.js');
const createChannel = require('../lib-fabric/create-channel.js');
const joinChannel   = require('../lib-fabric/join-channel.js');
const install       = require('../lib-fabric/install-chaincode.js');
const instantiate   = require('../lib-fabric/instantiate-chaincode.js');
const invoke        = require('../lib-fabric/invoke-transaction.js');
const query         = require('../lib-fabric/query.js');

const config = require('../config.json');
const packageInfo = require('../package.json');

const ORG = process.env.ORG;
const USERNAME = config.user.username;
const LEDGER_CONFIG_DIR  = '../artifacts/channel/';
const GENESIS_BLOCK_FILE = 'genesis.block';

logger.info('**************    API SERVER %s  ******************', packageInfo.version);
logger.info('Admin     : ' + USERNAME);
logger.info('Org name  : ' + ORG);

if(!ORG){
  throw new Error('ORG must be set in environment');
}


const app = express(); // root app
// custom middleware: use res.promise() to send promise response
app.use(expressPromise());
const adminPartyApp = express();
adminPartyApp.use(expressPromise());


module.exports = function(){ return app; };

///////////////////////////////////////////////////////////////////////////////
//////////////////////////////// SET CONFIGURATIONS ///////////////////////////
///////////////////////////////////////////////////////////////////////////////

//support parsing of application/json type post data
app.use(bodyParser.json());
//support parsing of application/x-www-form-urlencoded post data
app.use(bodyParser.urlencoded({ extended: false }));

// relax cors
function corsCb(req, cb){
  cb(null, {origin: req.headers.origin, credentials:true});
}
app.options('*', cors(corsCb));
app.use(cors(corsCb));

// enable admin party before authorization, but after cors
if(config.admin_party) {
    logger.info('**************    ADMIN PARTY ENABLED     ******************');
    app.use(adminPartyApp);
}


// set secret variable
app.set('secret', config.jwt_secret);

const pathExcluded = ['/config', '/config.js', '/socket.io', '/genesis'];
app.use(expressJWT({
    secret: config.jwt_secret
}).unless({
    path: pathExcluded
}));

// extract token
// https://www.npmjs.com/package/express-bearer-token
app.use(bearerToken());

// replace Buffer with Buffer value recursively in the response object
app.use(function(req,res,next){
    // replace res.send()
    const originalSend = res.send;

    res.send = function(data){
        if(!res._binary) {
          data = tools.replaceBuffer(data);
          data = tools.replaceLong(data);
        }
        return originalSend.call(res, data);
    };

    next();
});

// verify token
app.use(function(req, res, next) {
    if ( pathExcluded.indexOf(req.originalUrl) >= 0) {
        return next();
    }

    const token = req.token;
    jwt.verify(token, app.get('secret'), function(err, decoded) {
        if (err) {
            res.error('Failed to authenticate token. Make sure to include the ' +
                'token returned from /users call in the authorization header ' +
                ' as a Bearer token');
            return;
        } else {
            // add the decoded user name and org name to the request object
            // for the downstream code to use
            req.username = decoded.username;
            req.orgname = decoded.orgName;
            logger.debug(util.format('Decoded from JWT token: username - %s, orgname - %s', decoded.username, decoded.orgName));
            return next();
        }
    });
});

function _getToken(username, org) {
  return jwt.sign({
    exp: Math.floor(Date.now() / 1000) + parseInt(config.jwt_expiretime),
    username: username,
    orgName: org
  }, app.get('secret'));
}

// refresh token
app.post('/token', function(req, res) {
    res.send({token: _getToken(req.username, req.orgname)});
});

///////////////////////////////////////////////////////////////////////////////
///////////////////////// REST ENDPOINTS START HERE ///////////////////////////
///////////////////////////////////////////////////////////////////////////////

// (admin party) Register and enroll user
adminPartyApp.post('/users', function(req, res) {
    logger.info('**************** ENROLL USER ****************');
    const username = req.body.username;

    logger.debug('End point : /users');
    logger.debug('User name : ' + username);

    if (!username) {
        res.error(getErrorMessage('\'username\''));
        return;
    }

    let authMiddleware;
    try {
      authMiddleware = require('../middleware-auth');
    } catch(e) {
      logger.debug('There is no additional auth middleware. Continue as is');
      authMiddleware = Promise.resolve.bind(Promise);
    }

    res.promise(
        authMiddleware(username, req.body.password, ORG)
          .then(() => {
            return helper.getClientUser(username, ORG)
              .then(user => {
                return {
                  success: true,
                  secret: user._enrollmentSecret,
                  message: username + ' enrolled Successfully',
                };
              })
              .then(response => {
                if (response && typeof response !== 'string') {
                  response.token = _getToken(username, ORG);
                  return response;
                } else {
                  return Promise.reject(response);
                }
              });
          })
    );
});


// (admin party) Create Channel
adminPartyApp.post('/channels', function(req, res) {
    logger.info('<<<<<<<<<<<<<<<<< C R E A T E  C H A N N E L >>>>>>>>>>>>>>>>>');
    logger.debug('End point : /channels');
    const chaincodeName     = req.body.channelName;
    const channelConfigPath = req.body.channelConfigPath;

    logger.debug('Channel ID : ' + chaincodeName);
    logger.debug('channelConfigPath : ' + channelConfigPath);

    if (!chaincodeName) {
        res.error(getErrorMessage('\'channelName\''));
        return;
    }
    if (!channelConfigPath) {
        res.error(getErrorMessage('\'channelConfigPath\''));
        return;
    }

    res.promise(
        createChannel.createChannel(chaincodeName, channelConfigPath, USERNAME, ORG)
    );
});


// (admin party) Join Channel
adminPartyApp.post('/channels/:channelName/peers', function(req, res) {
    logger.info('<<<<<<<<<<<<<<<<< J O I N  C H A N N E L >>>>>>>>>>>>>>>>>');
    const chaincodeName = req.params.channelName;
    const peersId = req.body.peers || [];
    const peers   = peersId.map(getPeerHostByCompositeID);
    logger.debug('channelName : ' + chaincodeName);
    logger.debug('peers : ' + peers);

    if (!chaincodeName) {
        res.error(getErrorMessage('\'channelName\''));
        return;
    }
    if (!peers || peers.length === 0) {
        res.error(getErrorMessage('\'peers\''));
        return;
    }

    res.promise(
        joinChannel.joinChannel(peers, chaincodeName, USERNAME, ORG)
    );
});


// (admin party) Install chaincode on target peers
adminPartyApp.post('/chaincodes', function(req, res) {
    logger.debug('==================== INSTALL CHAINCODE ==================');

    const chaincodeName = req.body.chaincodeName;
    const chaincodePath = req.body.chaincodePath;
    const chaincodeVersion = req.body.chaincodeVersion;
    const peersId = req.body.peers || [];
    const peers   = peersId.map(getPeerHostByCompositeID);

    logger.debug('peers : ' + peers); // target peers list
    logger.debug('chaincodeName : ' + chaincodeName);
    logger.debug('chaincodePath  : ' + chaincodePath);
    logger.debug('chaincodeVersion  : ' + chaincodeVersion);
    if (!peers || peers.length === 0) {
        res.error(getErrorMessage('\'peers\''));
        return;
    }
    if (!chaincodeName) {
        res.error(getErrorMessage('\'chaincodeName\''));
        return;
    }
    if (!chaincodePath) {
        res.error(getErrorMessage('\'chaincodePath\''));
        return;
    }
    if (!chaincodeVersion) {
        res.error(getErrorMessage('\'chaincodeVersion\''));
        return;
    }

    res.promise(
      install.installChaincode(peers, chaincodeName, chaincodePath, chaincodeVersion, USERNAME, ORG)
    );
});


// (admin party) Instantiate chaincode on target peers
adminPartyApp.post('/channels/:channelName/chaincodes', function(req, res) {
    logger.debug('==================== INSTANTIATE CHAINCODE ==================');
    const chaincodeName    = req.body.chaincodeName;
    const chaincodeVersion = req.body.chaincodeVersion;
    const functionName = req.body.functionName;
    const channelName  = req.params.channelName;
    const args = req.body.args;

    logger.debug('channelName  : ' + channelName);
    logger.debug('chaincodeName : ' + chaincodeName);
    logger.debug('chaincodeVersion  : ' + chaincodeVersion);
    logger.debug('functionName  : ' + functionName);
    logger.debug('args  : ' + args);

    if (!chaincodeName) {
        res.error(getErrorMessage('\'chaincodeName\''));
        return;
    }
    if (!chaincodeVersion) {
        res.error(getErrorMessage('\'chaincodeVersion\''));
        return;
    }
    if (!functionName) {
        res.error(getErrorMessage('\'functionName\''));
        return;
    }
    if (!args) {
        res.error(getErrorMessage('\'args\''));
        return;
    }


    res.promise(
      instantiate.instantiateChaincode(channelName, chaincodeName, chaincodeVersion, functionName, args, USERNAME, ORG)
    );
});


///////////////////////// REGULAR REST ENDPOINTS START HERE ///////////////////////////

// get public config
const clientConfig = hfc.getConfigSetting('config');
clientConfig.org = ORG;

app.get('/config.js', expressEnv('__config', clientConfig));
app.get('/config', function(req, res) {
    res.setHeader('X-Api-Version', packageInfo.version);
    res.send(clientConfig);
});


//Query hyperledger genesis block
app.get('/genesis', function(req, res) {
  logger.debug('================ GET GENESIS BLOCK ======================');

  res._binary = true; // prevents base64 buffer encoding
  res.promise(
    tools.readFilePromise(path.join(__dirname, RELPATH, LEDGER_CONFIG_DIR, GENESIS_BLOCK_FILE))
  );
});


// Query to fetch channels
app.get('/channels', function(req, res) {
  logger.debug('================ GET CHANNELS ======================');
  logger.debug('peer: ' + req.query.peer);
  const peer = req.query.peer;

  if (!peer) {
    res.error(getErrorMessage("'peer'"));
    return;
  }

  res.promise(
    query.getChannels(peer, req.username, ORG)
  );
});


//Query for Channel Information
app.get('/channels/:channelName', function(req, res) {
  logger.debug('================ GET CHANNEL INFORMATION ======================');
  logger.debug('channelName : ' + req.params.channelName);
  let channelName = req.params.channelName;
  let peer = req.query.peer;

  if (!peer) {
    res.error(getErrorMessage("'peer'"));
    return;
  }

  res.promise(
    query.getChannelInfo(peer, channelName, req.username, ORG)
  );
});


//Query channel binary configuration
app.get('/channels/:channelName/config', function(req, res) {
  logger.debug('================ GET CHANNEL BINARY CONFIG ======================');
  logger.debug('channelName : ' + req.params.channelName);

  // let channelName = req.params.channelName;
  const channelFile = req.params.channelName + '.tx';

  res._binary = true; // prevents base64 buffer encoding
  res.promise(
    tools.readFilePromise(path.join(__dirname, RELPATH, LEDGER_CONFIG_DIR, channelFile))
  );
});



// Invoke transaction on chaincode on target peers
app.post('/channels/:channelName/chaincodes/:chaincodeName', function(req, res) {
    logger.debug('==================== INVOKE ON CHAINCODE ==================');
    const chaincodeName = req.params.chaincodeName;
    const channelName   = req.params.channelName;
    const peersId       = req.body.peers || [];
    const peers = peersId.map(getPeerHostByCompositeID);

    const fcn = req.body.fcn;
    const args = req.body.args;
    logger.debug('channelName  : ' + channelName);
    logger.debug('chaincodeName : ' + chaincodeName);
    logger.debug('peersId  : ', JSON.stringify(peersId) );
    logger.debug('peers  : ', JSON.stringify(peers) );
    logger.debug('fcn  : ' + fcn);
    logger.debug('args  : ' + args);
    if (!peers || peers.length === 0) {
      res.json(getErrorMessage('\'peers\''));
      return;
    }
    if (!chaincodeName) {
      res.error(getErrorMessage('\'chaincodeName\''));
      return;
    }
    if (!fcn) {
        res.error(getErrorMessage('\'fcn\''));
        return;
    }
    if (!args) {
        res.error(getErrorMessage('\'args\''));
        return;
    }

    res.promise(
      invoke.invokeChaincode(peers, channelName, chaincodeName, fcn, args, req.username, ORG)
        .then(function(transactionId){
          return {transaction:transactionId};
        })
    );
});


// Query on chaincode on target peers
app.get('/channels/:channelName/chaincodes/:chaincodeName', function(req, res) {
    logger.debug('==================== QUERY BY CHAINCODE ==================');
    const channelName   = req.params.channelName;
    const chaincodeName = req.params.chaincodeName;
    let args = req.query.args;
    let fcn  = req.query.fcn;
    let peerId = req.query.peer;
    const peerInfo = getPeerInfoByCompositeID(peerId);

    logger.debug('channelName : ' + channelName);
    logger.debug('chaincodeName : ' + chaincodeName);
    logger.debug('peerId : ', peerId);
    logger.debug('fcn  : ' + fcn);
    logger.debug('args : ' + args);

    if (!chaincodeName) {
        res.error(getErrorMessage('\'chaincodeName\''));
        return;
    }
    if (!fcn) {
        res.error(getErrorMessage('\'fcn\''));
        return;
    }
    if (!args) {
      res.error(getErrorMessage('\'args\''));
      return;
    }
    if (!peerInfo) {
      res.error(getErrorMessage('\'peerInfo\''));
      return;
    }
    if (peerInfo.org !== ORG) {
      res.error("Cannot query foreign peers");
      return;
    }
    args = args.replace(/'/g, '"');
    args = JSON.parse(args);
    logger.debug(args);


    res.promise(
      query.queryChaincode(peerInfo.peer, channelName, chaincodeName, args, fcn, req.username, ORG)
    );
});


//  Query Get Block by BlockNumber
app.get('/channels/:channelName/blocks/:blockId', function(req, res) {
    logger.debug('==================== GET BLOCK BY NUMBER ==================');
    let channelName = req.params.channelName;
    let blockId     = req.params.blockId;
    let peer        = req.query.peer;

    logger.debug('channelName : ' + channelName);
    logger.debug('BlockID : ' + blockId);
    logger.debug('Peer : ' + peer);

    if (!peer) {
      res.error(getErrorMessage("'peer'"));
      return;
    }
    if (!blockId) {
        res.error(getErrorMessage('\'blockId\''));
        return;
    }

    res.promise(
      query.getBlockByNumber(peer, channelName, blockId, req.username, ORG)
    );
});

// Query Get Block by Hash
app.get('/channels/:channelName/blocks', function(req, res) {
  logger.debug('================ GET BLOCK BY HASH ======================');
  logger.debug('channelName : ' + req.params.channelName);
  let channelName = req.params.channelName;
  let hash = req.query.hash;
  let peer = req.query.peer;

  if (!peer) {
    res.error(getErrorMessage("'peer'"));
    return;
  }
  if (!hash) {
    res.error(getErrorMessage('\'hash\''));
    return;
  }

  res.promise(
    query.getBlockByHash(peer, channelName, hash, req.username, ORG)
  );
});


// Query Get Transaction by Transaction ID
app.get('/channels/:channelName/transactions/:trxnId', function(req, res) {
    logger.debug('================ GET TRANSACTION BY TRANSACTION_ID ======================');
    logger.debug('channelName : ' + req.params.channelName);
    let channelName = req.params.channelName;
    let trxnId = req.params.trxnId;
    let peer = req.query.peer;

    if (!peer) {
      res.error(getErrorMessage("'peer'"));
      return;
    }
    if (!trxnId) {
        res.error(getErrorMessage('\'trxnId\''));
        return;
    }

    res.promise(
      query.getTransactionByID(peer, channelName, trxnId, req.username, ORG)
    );
});


// Query to fetch all Installed/instantiated chaincodes
app.get('/chaincodes', function(req, res) {
    let peer        = req.query.peer;
    let installType = req.query.type || 'installed';
    let channelName = req.query.channel;
    //TODO: add Constnats
    if (installType === 'installed') {
        logger.debug('================ GET INSTALLED CHAINCODES ======================');
    } else {
        logger.debug('================ GET INSTANTIATED CHAINCODES ======================');
        if(!channelName){
          res.error(getErrorMessage('\'channel\''));
          return;
        }
    }
    if (!peer) {
      res.error(getErrorMessage("'peer'"));
      return;
    }


    res.promise(
      query.getInstalledChaincodes(peer, channelName, installType, USERNAME, ORG)
    );
});



// at last - report any error =)
app.use(function(err, req, res) {
    res.error(err);
});


function getErrorMessage(field) {
  return field + ' field is missing or Invalid in the request';
}


/**
 * Get peer host:port by composite id.
 * Composite ID is a combination of orgID and peerID, split by '/'. For example: 'org1/peer2'
 * @param {string} orgPeerID
 * @returns {string}
 */
function getPeerHostByCompositeID(orgPeerID){
  const parts = orgPeerID.split('/');
  const peer = networkConfig[parts[0]][parts[1]] || {};
  return tools.getHost(peer.requests);
}
/**
 * Get peer host:port by composite id.
 * Composite ID is a combination of orgID and peerID, split by '/'. For example: 'org1/peer2'
 * @param {string} orgPeerID
 * @returns {{peer:string, org:string}}
 */
function getPeerInfoByCompositeID(orgPeerID){
  const parts = orgPeerID.split('/');
  return parts ? {peer: parts[1], org: parts[0]} : null;
}