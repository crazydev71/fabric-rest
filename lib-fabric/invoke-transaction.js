/**
 * Copyright 2017 IBM All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 *  Unless required by applicable law or agreed to in writing, software
 *  distributed under the License is distributed on an "AS IS" BASIS,
 *  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 *  See the License for the specific language governing permissions and
 *  limitations under the License.
 */
'use strict';
const util = require('util');
const tools = require('../lib/tools.js');

const config = require('../config.json');
const helper = require('./helper.js');
const logger = helper.getLogger('invoke-chaincode');

const peerListener = require('./peer-listener');



// Invoke transaction on chaincode on target peers
function invokeChaincode(peersUrls, channelID, chaincodeName, fcn, args, username, org, _retryAttempts) {
  if(typeof _retryAttempts === "undefined"){
    _retryAttempts = 10; // TODO: default attempts count
  }

	logger.debug(util.format('\n============ invoke transaction as %s@%s ============\n', username, org));
  // const client = new FabricClient(username, org);
  // const channel = client.getChannel(channelID);
  // const targets = FabricClient.newPeers(peersUrls);

	const targets = helper.newPeers(peersUrls);
	let tx_id = null;
	let channel;

  return helper.getChannelForOrg(channelID, username, org)
    .then(_channel=>{
      channel = _channel;
      const client = channel.getClient();

			//
			tx_id = client.newTransactionID();
			logger.debug('Sending transaction proposal "%j"', tools.replaceBuffer(tx_id));
			// send proposal to endorser
			const request = {
				targets: targets,
				chaincodeId: chaincodeName,
				fcn: fcn,
				args: args,
				chainId: channelID,
				txId: tx_id
			};
			return channel.sendTransactionProposal(request);
		})

		.then((results) => {
			const proposalResponses = results[0] || [];
			const proposal = results[1];
			let lastError = null;
			for (let i=0, n=proposalResponses.length; i<n; i++){
				const response = proposalResponses[i] || {};
				const prResponseStatus = response.response ? response.response.status : -1;
				if (prResponseStatus === 200) {
					logger.info('transaction proposal was good');
				} else {
					logger.error('transaction proposal was bad', response);
					lastError = response.message || 'transaction proposal was bad';
				}
			}
			if (lastError) {
				throw new Error(lastError||'Failed to send Proposal or receive valid response. Response null or status is not 200. exiting...');
			}

			logger.debug(util.format(
				'Successfully sent Proposal and received ProposalResponse: Status - %s, message - "%s", metadata - "%s", endorsement signature: %s',
				proposalResponses[0].response.status,
				proposalResponses[0].response.message,
				proposalResponses[0].response.payload,
				proposalResponses[0].endorsement.signature.toString('base64')
			));

			const request = {
				proposalResponses: proposalResponses,
				proposal: proposal
			};


			// set the transaction listener and set a timeout of 30sec
			// if the transaction did not get committed within the timeout period,
			// fail the test

      const channelEventHub = peerListener.listenChannel(channel);
      let eventMonitor = new Promise((resolve, reject) => {
				const tx_id_string = tx_id.getTransactionID();
        let handle = setTimeout(() => {
          // do the housekeeping when there is a problem
          channelEventHub.unregisterTxEvent(tx_id_string);
          logger.warn('Timeout - Failed to receive the transaction event');
          reject(new Error('Timed out waiting for block event'));
        }, parseInt(config.eventWaitTime));

        channelEventHub.registerTxEvent(tx_id_string, (event_tx_id/*, status, block_num*/) => {
            clearTimeout(handle);
            channelEventHub.unregisterTxEvent(event_tx_id);
            logger.debug('Successfully received the transaction event');

            resolve(event_tx_id);
          }, (error)=> {
            clearTimeout(handle);
						logger.warn('Failed to receive the transaction event ::'+error);
            reject(error);
          }
        );
      });

			logger.debug('Committing transaction "%j"', tools.replaceBuffer(tx_id));
			return Promise.all([channel.sendTransaction(request), eventMonitor]).then((results) => {
			// return Promise.all([sendPromise].concat(eventPromises)).then((results) => {
				logger.debug(' event promise all complete and testing complete');
				return results[0]; // the first returned value is from the 'sendPromise' which is from the 'sendTransaction()' call
			});

		})

		.then((response) => {
			if (response.status === 'SUCCESS') {
				logger.info('Successfully sent transaction to the orderer.');
				return tx_id.getTransactionID();
			} else {
				logger.error('Failed to order the transaction. Error code: ' + response.status);
				throw new Error('Failed to order the transaction. Error code: ' + response.status);
			}
		})
		.catch(function(e){
			if(e && e.code === "MVCC_READ_CONFLICT"){
				logger.info('Invoke retry %s times', _retryAttempts);
				// orderer race condition.
				// just retry the transaction
				if(_retryAttempts>0){
					_retryAttempts--;
					return invokeChaincode(peersUrls, channelID, chaincodeName, fcn, args, username, org, _retryAttempts);
				}
			}
			throw e;
		});


}

exports.invokeChaincode = invokeChaincode;
