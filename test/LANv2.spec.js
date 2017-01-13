/* eslint-env es6, mocha, node */
const Client = require('../LANv2');

describe('Client', () => {

	describe('constructor', () => {
		it('is not supported, use Client.create');
	});

	describe('static listen', () => {
		it('binds a new UDPv4 socket', () => {
			return Client.create().then((client) => {
				client.should.be.instanceof(Client);
				client.should.have.property('socket');
			});
		});
	});

});
