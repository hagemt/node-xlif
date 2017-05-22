/* eslint-env es6, node */
const EventEmitter = require('events')
const HTTP = require('http')

const _ = require('lodash')
const Bunyan = require('bunyan')
const request = require('request')

const defaultEventEmitter = new EventEmitter()

/* istanbul ignore next */
defaultEventEmitter.on('error', (error) => {
	rootLogger.warn(error, 'from RESTv1 Client')
})

const FULFILLING_STATUS_CODES = new Set([200, 207]) // OK, Multi-Status
const isValidNumber = statusCode => FULFILLING_STATUS_CODES.has(statusCode)
const isValidString = maybeString => _.isString(maybeString) && !!maybeString

class ResponseError extends Error {
	constructor (client, object) {
		const statusCode = _.get(object, 'statusCode', 418)
		super(_.get(HTTP.STATUS_CODES, statusCode, 'Unknown'))
		Object.defineProperty(this, 'response', { value: object })
		Object.freeze(this)
	}
}

class ResponseResult {
	constructor (client, object) {
		Object.assign(this, object)
		Object.freeze(this)
	}
}

const colors = new Map() // shared between instances

const memoize = (cache, ...args) => {
	const memoized = Object.assign(_.memoize(...args), { cache })
	return key => Promise.resolve(memoized(key))
		.then((result) => {
			cache.set(key, result)
			return result
		})
		.catch((reason) => {
			cache.delete(key) // don't keep failures
			return Promise.reject(reason)
		})
}

const rootLogger = Bunyan.createLogger({ name: 'LIFX' })

class Client {

	constructor (options) {
		const eventsEmitter = _.get(options, 'events', defaultEventEmitter)
		const parentLogger = _.get(options, 'log', rootLogger)
		const secretBearerToken = _.get(options, 'secret')
		if (!isValidString(secretBearerToken)) {
			throw new TypeError('secret String required')
		}
		const childLogger = parentLogger.child({
			API: 'RESTv1',
			component: 'client',
		})
		this.request = request.defaults({
			baseUrl: 'https://api.lifx.com',
			headers: {
				Authorization: `Bearer ${secretBearerToken}`,
			},
			json: true,
		})
		Object.defineProperty(this, 'colors', { value: colors })
		Object.defineProperty(this, 'events', { value: eventsEmitter })
		Object.defineProperty(this, 'log', { value: childLogger })
		this.validateColor = memoize(this.colors, this.validateColor.bind(this))
		Object.freeze(this)
	}

	static fromSecret (secret) {
		return new Client({ secret })
	}

	get version () {
		return this.log.fields.API
	}

	inspect () {
		return `Client[${this.version}]`
	}

	listLights (selector = 'all') {
		return this.send({ method: 'GET', uri: `/v1/lights/${selector}` })
			.then(results => results.map(({ id }) => new Selection(this, `id:${id}`)))
	}

	listScenes () {
		return this.send({ method: 'GET', uri: '/v1/scenes' })
			.then(results => results.map(({ uuid }) => new Scene(this, uuid)))
	}

	send (...args) {
		const requestObject = Object.assign({}, ...args)
		return new Promise((resolve, reject) => {
			this.log.trace({ request: requestObject }, 'starting')
			this.request(requestObject, (requestError, responseObject, body) => {
				this.log.trace({ request: requestObject, response: body }, 'complete')
				if (!requestError && isValidNumber(responseObject.statusCode)) resolve(body)
				else reject(requestError || new ResponseError(this, responseObject))
			})
		}).then((body) => {
			const { error: string, results: array } = Object(body)
			if (_.isArrayLikeObject(array)) {
				const results = Array.from(array, e => new ResponseResult(this, e))
				this.events.emit('results', ...results)
				return results
			}
			/* istanbul ignore next */
			if (_.isString(string)) {
				const error = new Error(string)
				this.events.emit('error', error)
				return Promise.reject(error)
			}
			return body
		})
	}

	setStates (defaults, ...states) {
		const defaultsObject = Object(defaults)
		const statesArray = Array.from(states, Object)
		const body = { defaults: defaultsObject, states: statesArray }
		return this.send({ body, method: 'PUT', uri: '/v1/lights/states' })
			.then(results => results.map(({ operation }) => operation))
	}

	validateColor (string) {
		return this.send({ method: 'GET', qs: { string }, uri: '/v1/color' })
	}

}

class Selection {

	constructor (client, selector) {
		if (!(client instanceof Client)) {
			throw new TypeError('RESTv1 Client required')
		}
		if (!_.isString(selector)) {
			throw new TypeError('selector String required')
		}
		Object.assign(this, { client, selector })
		Object.freeze(this)
	}

	inspect () {
		return `Selection[${this.selector}]`
	}

	set breathe (body) {
		const uri = `/v1/lights/${this.selector}/effects/breathe`
		this.client.send({ body, method: 'POST', uri })
	}

	set cycle (body) {
		const uri = `/v1/lights/${this.selector}/cycle`
		this.client.send({ body, method: 'POST', uri })
	}

	set pulse (body) {
		const uri = `/v1/lights/${this.selector}/effects/pulse`
		this.client.send({ body, method: 'POST', uri })
	}

	get state () {
		const uri = `/v1/lights/${this.selector}`
		return this.client.send({ method: 'GET', uri })
	}

	set state (body) {
		const uri = `/v1/lights/${this.selector}/state`
		this.client.send({ body, method: 'PUT', uri })
	}

	set toggle (body) {
		const uri = `/v1/lights/${this.selector}/toggle`
		this.client.send({ body, method: 'POST', uri })
	}

}

const staticFactory = _.memoize((t, T) => new T(t))
staticFactory.cache = new WeakMap() // re-use Actions

class Action {

	constructor (unboundFunction) {
		if (!Action.supports(unboundFunction)) {
			throw new TypeError('unbound Function required')
		}
		this.function = unboundFunction
		Object.freeze(this)
	}

	activate (selection, ...args) {
		if (!(selection instanceof Selection)) {
			return Promise.reject(new TypeError('#activate requires Selection'))
		}
		return selection.state.then((oldState) => {
			return this.call(selection, ...args) // => Promise<ignored:Any>
				.then(() => selection.state.then(newState => [oldState, newState]))
		})
	}

	call (object, ...args) {
		return Promise.all(args) // => Promise<arguments:Array>
			.then(array => this.function.apply(object, array))
	}

	get name () {
		return this.function.name
	}

	inspect () {
		return `Action[${this.name}]`
	}

	static breatheEffect (...defaultObjects) {
		const defaults = Object.assign({}, ...defaultObjects)
		return Action.fromFunction(function breathe (...args) {
			return this.breathe = Object.assign({}, defaults, ...args)
		})
	}

	static cycleBackward (...defaultObjects) {
		const defaults = Object.assign({}, ...defaultObjects)
		return Action.fromFunction(function cycle (...states) {
			return this.cycle = { defaults, direction: 'backward', states }
		})
	}

	static cycleForward (...defaultObjects) {
		const defaults = Object.assign({}, ...defaultObjects)
		return Action.fromFunction(function cycle (...states) {
			return this.cycle = { defaults, direction: 'forward', states }
		})
	}

	static fromFunction (unboundFunction) {
		return staticFactory(unboundFunction, Action)
	}

	static supports (maybeFunction) {
		if (!_.isFunction(maybeFunction)) return false
		return !/^bound /.test(_.get(maybeFunction, 'name'))
	}

	static pulseEffect (...defaultObjects) {
		const defaults = Object.assign({}, ...defaultObjects)
		return Action.fromFunction(function pulse (...args) {
			return this.pulse = Object.assign({}, defaults, ...args)
		})
	}

	static setState (...defaultObjects) {
		const defaults = Object.assign({}, ...defaultObjects)
		return Action.fromFunction(function state (...args) {
			return this.state = Object.assign({}, defaults, ...args)
		})
	}

	static togglePower (...defaultObjects) {
		const defaults = Object.assign({}, ...defaultObjects)
		return Action.fromFunction(function toggle (...args) {
			return this.toggle = Object.assign({}, defaults, ...args)
		})
	}

}

const action = Action.fromFunction(function activate (body) {
	const uri = `/v1/scenes/scene_id:${this.uuid}/activate`
	return this.client.send({ body, method: 'PUT', uri })
})

class Scene {

	constructor (client, uuid) {
		if (!(client instanceof Client)) {
			throw new TypeError('RESTv1 Client required')
		}
		if (!isValidString(uuid)) {
			throw new TypeError('Scene UUID required')
		}
		Object.assign(this, { action, client, uuid })
		Object.freeze(this)
	}

	activate (...args) {
		return this.action.call(this, Object.assign({}, ...args))
	}

	inspect () {
		return `Scene[${this.uuid}]`
	}

}

Object.assign(Client, { Action, Scene, Selection })
Object.assign(Client, { events: defaultEventEmitter })
Object.assign(Client, { ResponseError, ResponseResult })
module.exports = Object.assign(Client, { default: Client })

const secret = require('config').get('client.secret')

/* istanbul ignore next */
if (!module.parent) {
	const action = Action.togglePower()
	const client = Client.fromSecret(secret)
	client.getLights('all') // => Promise<all:Array<one:Selection>>
		.then(all => Promise.all(all.map(one => action.activate(one))))
		.then((results) => {
			client.log.trace({ results })
			process.exit()
		}, (reason) => {
			client.log.fatal(reason)
			process.exit(1)
		})
}
