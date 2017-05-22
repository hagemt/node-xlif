/* eslint-env es6, mocha, node */
const Client = require('../clients/LANv2.js')

describe('Client', () => {

	describe('constructor', () => {
		it('must be passed a bound Socket', () => {
			(() => new Client()).should.throw()
		})
	})

	describe('static create', () => {
		it('binds a new UDPv4 broadcast socket', () => {
			return Client.create().then((client) => {
				client.should.be.instanceof(Client)
				client.should.have.property('socket')
			})
		})
	})

})
