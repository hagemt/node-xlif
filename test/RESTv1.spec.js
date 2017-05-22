/* eslint-env es6, mocha, node */
const HTTP = require('http')

const config = require('config')

const Client = require('../clients/RESTv1.js')

describe('Client', () => {

	const secret = config.get('client.secret')

	describe('constructor', () => {

		it('requires a secret', () => {
			(() => new Client({ token: null })).should.throw()
			const client = Client.fromSecret(secret)
			client.should.be.instanceof(Client)
			client.inspect().should.equal('Client[RESTv1]')
		})

	})

	describe('#listLights', () => {

		it('obtains a list of Selections via Promise', () => {
			const client = Client.fromSecret(secret)
			return client.listLights().then((lights) => {
				lights.should.have.property('length', 1)
			})
		})

	})

	describe('#listScenes', () => {

		it('obtains a list of Scenes via Promise', () => {
			const client = Client.fromSecret(secret)
			return client.listScenes().then((lights) => {
				lights.should.have.property('length', 0)
			})
		})

	})

	describe('#send', () => {

		it('sends a REST call to the LIFX APIs', () => {
			const uri = '/v1/lights/all/toggle' // one of the simplest
			return Client.fromSecret(secret).send({ method: 'POST', uri })
		})

	})

	describe('#setStates', () => {

		it('allows manipulating lights without a Selection', () => {
			const client = Client.fromSecret(secret)
			const on = { power: 'on', selector: 'all' }
			const off = { power: 'off', selector: 'all' }
			return client.setStates({ duration: 1.0 }, on, off)
		})

	})

	describe('#validateColor', () => {

		it('returns a fulfilled Promise for a valid color', () => {
			const client = Client.fromSecret(secret)
			return client.validateColor('green').then((color) => {
				color.should.have.property('hue', 120)
				color.should.have.property('saturation', 1)
				color.should.have.property('brightness', null)
				color.should.have.property('kelvin', null)
			})
		})

		it('returns a rejected Promise for an invalid color', (done) => {
			const client = Client.fromSecret(secret)
			client.validateColor('invalid')
				.then(() => {
					done(new Error('invalid color should not validate'))
				}, (reason) => {
					reason.should.be.an.instanceof(Error)
					reason.should.have.property('message', HTTP.STATUS_CODES[422])
					done()
				})
		})

	})

	describe('Action', () => {

		it('wraps a Function for later binding', () => {
			const bound = (function f () {}).bind(null);
			(() => new Client.Action()).should.throw(TypeError);
			(() => new Client.Action(bound)).should.throw(TypeError)
			const action = Client.Action.fromFunction(function g (...args) {
				this.should.deepEqual({})
				args.should.have.length(0)
			})
			action.should.be.instanceof(Client.Action)
			action.inspect().should.equal('Action[g]')
			return action.call({})
		})

		describe('#activate', () => {

			it('resolves to previous and next states', () => {
				const client = Client.fromSecret(secret)
				const selection = new Client.Selection(client, 'all')
				const action = Client.Action.togglePower()
				return action.activate(selection)
					.then(([oldState, newState]) => {
						// these keys are somewhat difficult to predict:
						const keys = ['last_seen', 'power', 'seconds_since_seen']
						for (const key of keys) {
							delete newState[0][key]
							delete oldState[0][key]
						}
						oldState.should.deepEqual(newState)
					})
			})

			it('rejects without a Selection or on failure', () => {
				const action = Client.Action.togglePower()
				return action.activate().should.be.rejected()
			})

		})

	})

	// test Action.togglePower like setState, etc.

	describe('Selection', () => {

		it('combines a Client with a selector String', () => {
			const client = Client.fromSecret(secret);
			(() => new Client.Selection()).should.throw();
			(() => new Client.Selection(client)).should.throw()
			const selection = new Client.Selection(client, 'all')
			selection.should.have.property('client', client)
			selection.should.have.property('selector', 'all')
			selection.inspect().should.equal('Selection[all]')
		})

		it('can Action#activate bound to breathe effect', () => {
			const client = Client.fromSecret(secret)
			const selection = new Client.Selection(client, 'all')
			const action = Client.Action.breatheEffect({ color: 'orange' })
			action.should.be.instanceof(Client.Action)
			return action.activate(selection)
		})

		it('can Action#activate bound to pulse effect', () => {
			const client = Client.fromSecret(secret)
			const selection = new Client.Selection(client, 'all')
			const action = Client.Action.pulseEffect({ color: 'orange' })
			action.should.be.instanceof(Client.Action)
			return action.activate(selection)
		})

		it('can Action#activate bound to set state', () => {
			const client = Client.fromSecret(secret)
			const selection = new Client.Selection(client, 'all')
			const action = Client.Action.setState({ color: 'orange' })
			action.should.be.instanceof(Client.Action)
			return action.activate(selection)
		})

		it('can Action#activate bound to backward cycle', () => {
			const client = Client.fromSecret(secret)
			const selection = new Client.Selection(client, 'all')
			const action = Client.Action.cycleBackward({ power: 'on' })
			action.should.be.instanceof(Client.Action)
			return action.activate(selection, { color: 'red' }, { color: 'green' })
		})

		it('can Action#activate bound to forward cycle', () => {
			const client = Client.fromSecret(secret)
			const selection = new Client.Selection(client, 'all')
			const action = Client.Action.cycleForward({ power: 'on' })
			action.should.be.instanceof(Client.Action)
			return action.activate(selection, { color: 'yellow' }, { color: 'blue' })
		})

		it('can Action#activate bound to toggle power', () => {
			const client = Client.fromSecret(secret)
			const selection = new Client.Selection(client, 'all')
			const action = Client.Action.togglePower()
			action.should.be.instanceof(Client.Action)
			return action.activate(selection)
		})

	})

	describe('Scene', () => {

		it('combines a Client with an Action to #activate', () => {
			const client = Client.fromSecret(secret);
			(() => new Client.Scene()).should.throw();
			(() => new Client.Scene(client)).should.throw()
			const scene = new Client.Scene(client, 'uuid')
			scene.inspect().should.equal('Scene[uuid]')
			return scene.activate().should.be.rejected()
			// FIXME (hagemt): need to set up one Scene
		})

	})

})
