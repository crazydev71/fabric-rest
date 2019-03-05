/* globals io */
/**
 * @class SocketService
 * @classdesc
 * @require socket.io
 * @ngInject
 */
function SocketService(env, $rootScope, $log) {
  var SocketService = this;

  var STATE_CONNECTING   = 'connecting';
  var STATE_CONNECTED    = 'connected';
  var STATE_DISCONNECTED = 'disconnected';
  var STATE_ERROR = 'error';

  var socket;
  SocketService.state = STATE_DISCONNECTED;

  function _setState(newState) {
    'use strict';
    return function() {
      SocketService.state = newState;
      $rootScope.$apply();
    }
  }
  /**
   *
   */
  SocketService.connect = function(){
    if(socket){
      return socket;
    }
    socket = io(env.api);

    socket.on('connect', function(){
      _setState(STATE_CONNECTED)();
    });
    socket.on('disconnect',   _setState(STATE_DISCONNECTED));
    socket.on('reconnecting', _setState(STATE_CONNECTING));
    socket.on('reconnect_error', _setState(STATE_ERROR));

    socket.on('status', function(status){
      $log.debug('server status:', status);
      SocketService.state = status;
      $rootScope.$apply();
    });


    socket.on('chainblock', function(block){

      block.getChannel = block_getChannel;

      $rootScope.$broadcast('chainblock', block); // emit global event

      // emit channel specific event ('-c-' - is a first letter from 'channel')
      var blockChannel = block.getChannel();
      $log.debug('server block channel:', blockChannel);
      $rootScope.$broadcast('chainblock-ch-'+blockChannel, block);

      // emit type specific event ('-t-' - is a first letter from 'type')
      // $rootScope.$broadcast('chainblock-t-'+blockType, e);
    });


    // socket.on('ping', function(){
    //   console.log('socket: ping');
    // });
    // socket.on('pong', function(latency){
    //   console.log('socket: pong', latency);
    // });

    return socket;
  };

  // 'this' is a block
  function block_getChannel(){
    try{
      return this.data.data[0].payload.header.channel_header.channel_id;
    } catch(e) {
      return null;
    }
  }

  SocketService.getBlockChannel = function(block){
   return block.getChannel();
  };

  /**
   *
   */
  SocketService.getSocket = function(){
    return socket;
  };


  /**
   *
   */
  SocketService.getState = function(){
    return SocketService.state;
  };



}

angular.module('altrs.service.socket', ['altrs.config.env'])
  .service('SocketService', SocketService)
  .run(function(SocketService){
    SocketService.connect();
  });