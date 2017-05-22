/* eslint-env es6, node */
const _ = require('lodash')
const Bunyan = require('bunyan')

const getLogger = _.once(() => {
	return Bunyan.createLogger({
		name: 'LIFX',
	})
})

module.exports = { getLogger }
