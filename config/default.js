/* eslint-env node */
module.exports = {
	client: {
		secret: null, // Generate a token at: https://cloud.lifx.com/sign_in
		// then, copy this file to local.json5 (and fill in client.secret)
		// another option is to set process.env.LIFX_CLIENT_SECRET=...
	},
}