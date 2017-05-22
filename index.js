/* eslint-env es6, node */
const config = require('config')

const HTTPv1 = require('./clients/HTTPv1.js')
//const LANv2 = require('./clients/LANv2.js')

const secret = config.get('client.secret')
const instance = HTTPv1.fromSecret(secret)

module.exports = HTTPv1 // class
module.exports.default = instance
