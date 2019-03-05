/*

 */
"use strict";
const RELPATH = '/../'; // relative path to server root. Change it during file movement
const path  = require('path');
const fs    = require('fs');

const log4js = require('log4js');

const logger = log4js.getLogger('fabric-client');
logger.setLevel('INFO');

// const CONFIG_FILE_DEFAULT = '/etc/hyperledger/artifacts/network-config.json';
const CONFIG_FILE_DEFAULT = '../artifacts/network-config.json';

////
let configFile = process.env.CONFIG_FILE || CONFIG_FILE_DEFAULT;
if(!path.isAbsolute(configFile)){
  configFile = path.join(__dirname, RELPATH, configFile);
}
const configDir = path.dirname(configFile);

logger.info('Use network config file: %s', configFile);

// fs.accessSync(configFile, fs.constants.R_OK);
const config = JSON.parse(fs.readFileSync(configFile).toString());


///////
const hfc = require('fabric-client');
hfc.setLogger(logger);
hfc.addConfigFile(configFile);  // this config needed for lib-fabric
hfc.setConfigSetting('config', config);  // this config needed for client
hfc.setConfigSetting('config-dir',  configDir);
hfc.setConfigSetting('config-file', configFile);



// you can always get config:
// const ORGS = hfc.getConfigSetting('network-config');
// const CONFIG_DIR = hfc.getConfigSetting('config-dir');

module.exports = hfc;