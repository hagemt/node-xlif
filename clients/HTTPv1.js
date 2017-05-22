/* eslint-env es6, node */
const { EventEmitter } = require('events')
const { STATUS_CODES } = require('http')

const _ = require('lodash')
const config = require('config')
const request = require('request')

const Logging = require('./logging.js')
const rootLogger = Logging.getLogger()

const events = new EventEmitter()

/* istanbul ignore next */
events.on('error', (error) => {
	log.warn(error)
})

const log = rootLogger.child({
	component: 'events',
})

const SUCCESSFUL_STATUS_CODES = new Set([200, 207]) // OK, Multi-Status
const isSuccessful = statusCode => SUCCESSFUL_STATUS_CODES.has(statusCode)
const isNonEmptyString = anyString => _.isString(anyString) && !!anyString

class ResponseError extends Error {
	constructor (client, response) {
		const message = _.get(response, 'message', 'Blaze It')
		const statusCode = _.get(response, 'statusCode', 420)
		super(_.get(STATUS_CODES, statusCode, message))
		Object.defineProperties(this, {
			client: { value: client },
			response: { value: response },
		})
		Object.freeze(this)
	}
}

class ResponseResult {
	constructor (client, ...args) {
		Object.assign(this, ...args)
		Object.freeze(this)
	}
}

const colors = new Map() // cache:
const colorsFunction = (...args) => {
	const memoized = _.memoize(...args)
	memoized.cache = colors // Map-like instance
	return key => Promise.resolve(memoized(key))
		.then((result) => {
			colors.set(key, result)
			return result
		})
		.catch((reason) => {
			colors.delete(key) // immediately evict
			// failures should not remain cached
			return Promise.reject(reason)
		})
}

class Client {

	constructor (options) {
		const anyEventEmitter = _.get(options, 'events', events)
		const parentLogger = _.get(options, 'log', rootLogger)
		const secretBearerToken = _.get(options, 'secret')
		if (!isNonEmptyString(secretBearerToken)) {
			throw new TypeError('secret String required')
		}
		const childLogger = parentLogger.child({
			component: 'clients',
			interface: 'HTTPv1',
		})
		const requestFunction = request.defaults({
			baseUrl: 'https://api.lifx.com',
			headers: {
				Authorization: `Bearer ${secretBearerToken}`,
			},
			json: true,
		})
		const validateColor = colorsFunction(this.validateColor.bind(this))
		Object.defineProperties(this, {
			events: { value: anyEventEmitter },
			log: { value: childLogger },
			request: { value: requestFunction },
			validateColor: { value: validateColor },
		})
		Object.freeze(this)
	}

	static fromSecret (secret) {
		return new Client({ secret })
	}

	inspect () {
		return `Client[${this.log.fields.interface}]`
	}

	listLights (selector = 'all') {
		return this.sendRequest({ method: 'GET', uri: `/v1/lights/${selector}` })
			.then(body => _.map(body, ({ id }) => this.newSelection(`id:${id}`)))
	}

	listScenes () {
		return this.sendRequest({ method: 'GET', uri: '/v1/scenes' })
			.then(body => _.map(body, ({ uuid }) => this.newScene(uuid)))
	}

	newScene (...args) {
		return new Client.Scene(this, ...args)
	}

	newSelection (...args) {
		return new Client.Selection(this, ...args)
	}

	sendRequest (...args) {
		return new Promise((resolve, reject) => {
			const requestObject = Object.assign({}, ...args)
			this.log.trace({ request: requestObject }, 'starting')
			this.request(requestObject, (requestError, response, body) => {
				this.log.trace({ request: requestObject, response: body }, 'complete')
				if (!requestError && isSuccessful(response.statusCode)) resolve(body)
				else reject(requestError || new Client.ResponseError(this, response))
			})
		}).then((body) => {
			const message = _.get(body, 'error', '')
			const results = _.get(body, 'results', [])
			/* istanbul ignore next */
			if (message) {
				const error = new Client.ResponseError({ body, message })
				this.events.emit('error', error)
				return Promise.reject(error)
			}
			if (results.length > 0) {
				const wrapResult = result => new Client.ResponseResult(this, result)
				this.events.emit('results', Array.from(results, wrapResult))
			}
			return body
		})
	}

	setStates (defaults, ...states) {
		const defaultsObject = Object(defaults)
		const statesArray = Array.from(states, Object)
		const body = { defaults: defaultsObject, states: statesArray }
		return this.sendRequest({ body, method: 'PUT', uri: '/v1/lights/states' })
			.then(body => _.map(body.results, ({ operation }) => operation))
	}

	validateColor (string) {
		return this.sendRequest({ method: 'GET', qs: { string }, uri: '/v1/color' })
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
		this.client.sendRequest({ body, method: 'POST', uri })
	}

	set cycle (body) {
		const uri = `/v1/lights/${this.selector}/cycle`
		this.client.sendRequest({ body, method: 'POST', uri })
	}

	set pulse (body) {
		const uri = `/v1/lights/${this.selector}/effects/pulse`
		this.client.sendRequest({ body, method: 'POST', uri })
	}

	get state () {
		const uri = `/v1/lights/${this.selector}`
		return this.client.sendRequest({ method: 'GET', uri })
	}

	set state (body) {
		const uri = `/v1/lights/${this.selector}/state`
		this.client.sendRequest({ body, method: 'PUT', uri })
	}

	set toggle (body) {
		const uri = `/v1/lights/${this.selector}/toggle`
		this.client.sendRequest({ body, method: 'POST', uri })
	}

}

const staticFactory = _.memoize((t, T) => new T(t))
staticFactory.cache = new WeakMap() // re-use Actions

class Action {

	constructor (unboundFunction) {
		if (!Action.supportsFunction(unboundFunction)) {
			throw new TypeError('unbound Function required')
		}
		Object.defineProperties(this, {
			function: { value: unboundFunction },
		})
		Object.freeze(this)
	}

	activate (selection, ...args) {
		return selection.state.then((oldState) => {
			return Action.call(this, selection, ...args)
				.then(() => selection.state) // => Promise
				.then(newState => [oldState, newState])
		})
	}

	get name () {
		return this.function.name
	}

	inspect () {
		return `Action[${this.name}]`
	}

	static fromFunction (unboundFunction) {
		return staticFactory(unboundFunction, Action)
	}

	static supportsFunction (maybeFunction) {
		if (!_.isFunction(maybeFunction)) return false
		const name = _.get(maybeFunction, 'name', '')
		if (name.startsWith('bound ')) return false
		return isNonEmptyString(name) // anonymous
	}

	static breatheEffect (...defaultObjects) {
		const defaults = Object.assign({}, ...defaultObjects)
		return Action.fromFunction(function breathe (...args) {
			this.breathe = Object.assign({}, defaults, ...args)
			return this.state
		})
	}

	static cycleBackward (...defaultObjects) {
		const defaults = Object.assign({}, ...defaultObjects)
		return Action.fromFunction(function cycle (...states) {
			this.cycle = { defaults, direction: 'backward', states }
			return this.state
		})
	}

	static cycleForward (...defaultObjects) {
		const defaults = Object.assign({}, ...defaultObjects)
		return Action.fromFunction(function cycle (...states) {
			this.cycle = { defaults, direction: 'forward', states }
			return this.state
		})
	}

	static pulseEffect (...defaultObjects) {
		const defaults = Object.assign({}, ...defaultObjects)
		return Action.fromFunction(function pulse (...args) {
			this.pulse = Object.assign({}, defaults, ...args)
			return this.state
		})
	}

	static setState (...defaultObjects) {
		const defaults = Object.assign({}, ...defaultObjects)
		return Action.fromFunction(function state (...args) {
			this.state = Object.assign({}, defaults, ...args)
			return this.state
		})
	}

	static togglePower (...defaultObjects) {
		const defaults = Object.assign({}, ...defaultObjects)
		return Action.fromFunction(function toggle (...args) {
			this.toggle = Object.assign({}, defaults, ...args)
			return this.state
		})
	}

}

class Scene {

	constructor (client, id) {
		if (!(client instanceof Client)) {
			throw new TypeError('client RESTv1 required')
		}
		if (!isNonEmptyString(id)) {
			throw new TypeError('scene ID required')
		}
		const action = Action.fromFunction(function activate (body) {
			const uri = `/v1/scenes/scene_id:${this.id}/activate`
			return this.client.sendRequest({ body, method: 'PUT', uri })
		})
		Object.defineProperties(this, {
			action: { value: action },
			client: { value: client },
			id: { value: id },
		})
		Object.freeze(this)
	}

	activate (...args) {
		return Action.call(this.action, this, Object.assign({}, ...args))
	}

	inspect () {
		return `Scene[${this.id}]`
	}

}

Action.call = (action, target, ...args) => {
	if (!(action instanceof Action)) {
		return Promise.reject(new TypeError('an Action is required'))
	}
	if (!(target instanceof Selection) && !(target instanceof Scene)) {
		return Promise.reject(new TypeError('a Selection/Scene is required'))
	}
	return Promise.all(args) // => Promise<arguments:Array>
		.then(array => action.function.apply(target, array))
}

Object.assign(Client, { events, log })
Object.assign(Client, { Action, Scene, Selection })
Object.assign(Client, { ResponseError, ResponseResult })
module.exports = Object.assign(Client, { default: Client })

const delta = (left, right) => {
	if (left === right) return null
	if (!_.isObject(left) || !_.isObject(right)) {
		return [left, right] // tuple, for comparison
	}
	const result = {} // 2 build + return
	const leftSet = new Set(_.keys(left))
	const rightSet = new Set(_.keys(right))
	for (const key of new Set([...leftSet, ...rightSet])) {
		if (leftSet.has(key) && rightSet.has(key)) {
			const value = delta(left[key], right[key])
			if (value) result[key] = value
		} else if (leftSet.has(key)) {
			result[key] = [left[key], null]
		} else if (rightSet.has(key)) {
			result[key] = [null, right[key]]
		}
	}
	return _.keys(result).length === 0 ? null : result
}

module.exports.delta = delta

/* istanbul ignore next */
if (!module.parent) {
	const action = Action.togglePower({ duration: 0 })
	Client.fromSecret(config.get('client.secret'))
		.listLights('all') // => Promise<all:Array<one:Selection>>
		.then(all => Promise.all(all.map(one => action.activate(one))))
		.then((results) => {
			for (const [[before], [after]] of results) {
				const toggle = delta(before, after)
				log.info({ toggle }, 'toggled')
			}
			process.exit()
		}, (reason) => {
			log.fatal(reason)
			process.exit(1)
		})
}
