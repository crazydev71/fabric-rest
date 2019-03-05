'use strict';
const js_template_pre = '(function (window) {  window.$VAR = ';
const js_template_post = '; }(this));';

/**
 * @param {string} [varName]
 * @param {object} envConfig
 */
function envConfigMiddleware(varName, envConfig){
  // first argument can be omitted
  if (typeof envConfig === "undefined"){
    envConfig = varName;
    varName = '__env';
  }
  const env_code = JSON.stringify(envConfig || {});
  const variable = /*req.query.const ||*/ varName;
  const js_code = js_template_pre.replace('$VAR', variable) + env_code + js_template_post;

  return function(req, res){
    res.set({'Content-Type':'text/javascript'}).send(js_code);
  };
}


module.exports = envConfigMiddleware;