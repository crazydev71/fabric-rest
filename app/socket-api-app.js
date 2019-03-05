/**
 * Created by maksim on 7/18/17.
 */
"use strict";
const log4js = require('log4js');
const logger = log4js.getLogger('Socket');
const peerListener = require('../lib-fabric/peer-listener');
const helper = require('../lib-fabric/helper');

const hfc = require('../lib-fabric/hfc');
const networkConfig = hfc.getConfigSetting('network-config');

// config
const config = require('../config.json');
const USERNAME = config.user.username;

module.exports = {
  init: init
};

/**
 * @param {Server} io
 * @param {object} options
 */
function init(io, options){
  const ORG = options.org;

  const orgConfig = networkConfig[ORG];
  if(!orgConfig){
    throw new Error('No such organisation in config: '+ORG);
  }

  // log connections
  io.on('connection', function(socket){
    socket.emit('status', peerListener.isConnected() ? 'connected':'disconnected' );

    logger.debug('a new user connected:', socket.id);
    socket.on('disconnect', function(/*socket*/){
      logger.debug('user disconnected:', socket.id);
    });
    socket.on('listen_channel', function(opts) {
      if (typeof opts === 'string') {
        opts = {
          channelId: opts
        };
      }
      const channelID = opts.channelId;
      helper.getChannelForOrg(channelID, USERNAME, ORG)
        .then(channel => {
          peerListener.listenChannel(channel, opts.fullBlock);
          peerListener.registerBlockEvent(function(block){
            io.emit('chainblock', block);
          });

          // note: these statuses should be matched with client status set
          peerListener.eventHub.on('disconnected', function(){ io.emit('status', 'disconnected'); });
          peerListener.eventHub.on('connecting',   function(){ io.emit('status', 'connecting');   });
          peerListener.eventHub.on('connected',    function(){ io.emit('status', 'connected');    });
        });
    });
  });
}
