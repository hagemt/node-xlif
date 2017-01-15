# xfil

Simple clients to interface via the LIFX:

* REST interface (v1)
* LAN protocol (v2)

## RESTv1 (alpha)

Client concepts: Action, Selection, Scene and miscellaneous support Objects.

A `Client` is exported and decorated with three others, explained below:

Client instances should be obtained through the `static fromSecret` factory.

The constructor is another option; pass Object(s) like:

```
{
	events: EventEmitter, // default: Client.events
	log: Logger, // expects a Bunyan-like interface
	secret: String, // non-empty String (from LIFX)
}
```

### Action

Know IFTTT? An Action is a specialized then-that. (IFTTT calls these Applets now.)

Action instances wrap an unbound Function and call it with context + arguments.

The context is designed (but not required) to be `#call`'d on a Selection (see below).

An Action may only `#activate` upon a Selection, which wraps additional logic as follows:

1) The "old" (prior) `state` of the Selection, `s`, is obtained via the paired Client.
2) The Action is `#call`'d, binding `s` along with the other arguments passed to `#activate`.
3) The "new" (posterior) `state` of the Selection is obtained, then `return [old, new];`.

Many static factory methods are provided to create your own re-useable Action instances.

The most straightforward way to use a Client is to call `#setStates` like so:

```
const client = Client.fromSecret(...); // for Promise<responses:Array>
client.setStates({ duration: 1.0 }, { power: 'on', selector: 'all' });
// => all lights associated with the Client secret power on (within 1s)
```

### Selection

LIFX uses the concept of a selector, which allows a Client to target lights.

Read more about valid selectors here:
https://api.developer.lifx.com/docs/selectors

Use of a Selection to directly manipulate lights is quite simple:

```
const all = new Client.Selection(client, 'all');
// all is now a valid target for an Action, or:
all.breathe = ...; // sent as body to LIFX APIs
all.cycle = ...; // easier to construct via Action
all.pulse = ...; // very similar to "breathe" API
all.state // => Promise<state:Object> from API
all.state = { color: 'green' }; // for example
all.toggle = { duration: 1.0 }; // 1s fade on/off
```

N.B. `Client#listLights(selection = 'all') => Promise<Array<Selection>>`

### Scene

A Scene is a LIFX concept; with a Client, it is easy to `#listScenes` via Promise.

Much like an Action, Scene instances can be `#activated`, which simply:

1) Will `#call` an internal Action binding the Scene (`this`) with passed arguments.
2) N.B. Unlike a pure Action, a Scene DOES NOT operate (activate) upon a Selection.

Currently, the only supported field by the REST API (v1) is `duration`.

### etc.

Two additional support classes `ResponseError` and `ResponseResult` are exported.

These two pretty much wrap what their names imply, along with a Client reference.

In the future, retry (later, e.g. upon hitting rate limits) may be possible.

## LANv2 (incomplete)

This client is highly experimental and has not yielded even preliminary results.

It does not aim to replicate the interface exposed by the RESTv1 Client.

Requests (as per LIFX recommendation) are via UDP and throttled to 20/second.

Additionally, much less response information will be made available.

The wire protocol is documented here: https://lan.developer.lifx.com/
