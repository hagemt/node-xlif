/* eslint-env es6, mocha, node */
const HTTP = require('http');

const config = require('config');

const Client = require('../RESTv1');

describe('Client', () => {

	const secret = config.get('client.secret');

	describe('constructor', () => {

		it('requires a secret', () => {
			(() => new Client({ token: null })).should.throw();
			const client = Client.fromSecret(secret);
			client.should.be.instanceof(Client);
			client.inspect().should.equal(`Client[RESTv1]`);
		});

	});

	describe('#getLights', () => {
		it('obtains a list of Selections via Promise');
	});

	describe('#getScenes', () => {
		it('obtains a list of Scenes via Promise');
	});

	describe('#send', () => {
		it('sends a REST call to the LIFX APIs');
	});

	describe('#setStates', () => {
		it('allows manipulating lights without a Selection');
	});

	describe('#validateColor', () => {

		it('returns a fulfilled Promise for a valid color', () => {
			const client = Client.fromSecret(secret);
			return client.validateColor('green').then((color) => {
				color.should.have.property('hue', 120);
				color.should.have.property('saturation', 1);
				color.should.have.property('brightness', null);
				color.should.have.property('kelvin', null);
			});
		});

		it('returns a rejected Promise for an invalid color', (done) => {
			const client = Client.fromSecret(secret);
			client.validateColor('invalid')
				.then(() => {
					done(new Error('invalid color should not validate'));
				}, (reason) => {
					reason.should.be.an.instanceof(Error);
					reason.should.have.property('message', HTTP.STATUS_CODES[422]);
					done();
				});
		});

	});

});

describe('Action', () => {

	it('wraps a Function for later binding', () => {
		const bound = (function f () {}).bind(null);
		(() => new Client.Action()).should.throw(TypeError);
		(() => new Client.Action(bound)).should.throw(TypeError);
		const action = Client.Action.fromFunction(function g (...args) {
			this.should.deepEqual({});
			args.should.have.length(0);
		});
		action.should.be.instanceof(Client.Action);
		return action.call({});
	});

});

describe('Scene', () => {
	it('combines a Client with an Action to activate');
});

describe('Selection', () => {
	it('combines a Client with a selector String');
});

describe('events', () => {
	it('can be used to observe Client#send');
});
