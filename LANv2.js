/* eslint-env es6, node */
const EventEmitter = require('events');
const dgram = require('dgram');

const _ = require('lodash');
const Bunyan = require('bunyan');

const nonceByte = (r = Math.random()) => Math.floor(r * 0x100);
const nonceBytes = (length = 4) => Array.from({ length }, nonceByte);
const rootLogger = Bunyan.createLogger({ name: 'LIFX' }); // API: LANv2

const nextByteValue = number => (number + 1) % 0x100; // => Number in [0, 255]
const nextByte = () => nextByte.value = nextByteValue(nextByte.value);
Object.assign(nextByte, { value: 0 }); // 1, 2, ..., 0xFF, 0, 1, 2, ...

// https://lan.developer.lifx.com/v2.0/docs/header-description
const createMessage = (client, payload) => {
	const frame = Buffer.alloc(8);
	// 16+2+1+1+12+32=64 bit (8 byte) lay-out:
	// SSSSSSSS SSSSSSSS OOTAPPPP PPPPPPPP
	// ssssssss ssssssss ssssssss ssssssss
	// S = Size (uint16_t) (of entire message)
	// O = Origin (uint8_t) [always 0?]
	// T = Tagged (bool) [0/1 for discovery]
	// A = Addressable (bool) [always 1?)
	// P = Protocol (uint16_t) [always 0b0100_0000_0000 = 1024_10]
	// s = source (uint32_t) [nonce to identify client]
	const address = Buffer.alloc(16); // all zero?
	// 64+48+6+1+1+8=128 bit (16 byte) lay-out:
	// tttttttt tttttttt tttttttt tttttttt
	// tttttttt tttttttt tttttttt tttttttt
	// rrrrrrrr rrrrrrrr rrrrrrrr rrrrrrrr
	// rrrrrrrr rrrrrrrr rrrrrrAR SSSSSSSS
	// t = target (uint64_t) [DEVICE00/0's for all]
	// r = reserved (two chunks, must be all 0's)
	// A = ack_required (bool) [request acknowledgement]
	// R = res_required (bool) [request proper response]
	// S = sequence (uint8_t) [for client to distinguish]
	const header = Buffer.alloc(12);
	// 64+16+16=96 bit (8+2+2=12 byte) lay-out:
	// rrrrrrrr rrrrrrrr rrrrrrrr rrrrrrrr
	// rrrrrrrr rrrrrrrr rrrrrrrr rrrrrrrr
	// typetype typetype RRRRRRRR RRRRRRRR
	// r/R = reserved (64/16 bits) and type (16 bits)
	const message = Buffer.concat(frame, address, header, payload);
	if (message.length > 65535) throw new Error('over 4KB limit');
	message[0] = (message.length & 0xFF00) >> 8;
	message[1] = (message.length & 0x00FF) >> 0;
	message[2] = 0b00010100; // see above (OOTAPPPP)
	message.fill(client.nonce, 4, 8); // see Frame
	message[23] = nextByte(); // sequence Number
	// decorate with Functions for bit twiddling?
	return message; // set discovery, target, type
	// indirectly set {ack,res}_required as needed?
	// can the message itself be Object.freeze'd?
};

const sendPromise = (socket, ...args) => new Promise((resolve, reject) => {
	socket.send(...args, sendError => sendError ? reject(sendError) : resolve());
});

const send = _.throttle(sendPromise, 50); // limit messages to 20/second

class Client {

	constructor ({ events, log: parentLogger = rootLogger, socket }) {
		const childLogger = parentLogger.child({ component: 'client' });
		const eventsEmitter = events || new EventEmitter();
		eventsEmitter.on('error', (error) => {
			childLogger.warn(error);
		});
		eventsEmitter.on('message', (...args) => {
			childLogger.info(...args);
		});
		socket.on('close', () => {
			eventsEmitter.emit('error', new Error('Socket was #close-d'));
		});
		socket.on('error', (error) => {
			eventsEmitter.emit('error', error);
		});
		socket.on('message', (...args) => {
			eventsEmitter.emit('message', ...args);
		});
		const nonce = Object.freeze(Buffer.from(nonceBytes(4)));
		Object.defineProperty(this, 'events', { value: eventsEmitter });
		Object.defineProperty(this, 'log', { value: childLogger });
		Object.defineProperty(this, 'nonce', { value: nonce });
		Object.defineProperty(this, 'socket', { value: socket });
		Object.freeze(this);
	}

	static create (...args) {
		const getSocket = () => Client.createBroadcastSocket(); // default factory
		const { port = 56700, socket = getSocket() } = Object.assign({}, ...args);
		return new Promise((resolve, reject) => {
			if (!Number.isInteger(port) || port < 0 || port > 65535) {
				throw new TypeError('port must be a valid 16-bit integer');
			}
			socket.bind(port, (bindError) => {
				if (bindError) reject(bindError);
				else resolve(new Client({ socket }));
			});
		});
	}

	static createBroadcastSocket (...args) {
		const { type = 'udp4', reuseAddr = true } = Object.assign({}, ...args);
		const socket = dgram.createSocket({ type, reuseAddr });
		socket.once('listening', () => {
			socket.setBroadcast(true); // SO_BROADCAST
		});
		return socket;
	}

	discover (timeout = 1000, port = 56700) {
		this.log.info({ port }, 'will #discover');
		return new Promise((resolve, reject) => {
			const messages = []; // filter these?
			const consume = (message) => {
				messages.push(message);
			};
			const cleanup = () => {
				this.socket.removeListener('message', consume);
				setImmediate(resolve, messages);
			};
			const trigger = () => {
				// what payload needs to be passed?
				const message = createMessage(this);
				message[2] |= 0b00100000; // discovery tag
				message[22] |= 0b00000011; // ack/res tags
				return send(this.socket, message, port);
			};
			this.socket.on('message', consume); // listen for response
			trigger().then(() => setTimeout(cleanup, timeout), reject);
		});
	}

	send (timeout = 1000, payload) {
		this.log.info({ payload }, 'will #send');
		return new Promise((resolve, reject) => {
			const messages = []; // filter these?
			const consume = (message) => {
				messages.push(message);
			};
			const cleanup = () => {
				this.socket.removeListener('message', consume);
				setImmediate(resolve, messages);
			};
			const trigger = () => {
				// need to modify message based on payload:
				const message = createMessage(this, payload);
				return send(this.socket, message); // port?
			};
			this.socket.on('message', consume);
			trigger().then(() => setTimeout(cleanup, timeout), reject);
		});
	}

}

module.exports = Object.assign(Client, { default: Client });
