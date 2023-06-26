'use strict';

const Homey = require('homey');
const WebSocket = require('ws');
const {
  OAuth2Client,
  OAuth2Error,
} = require('homey-oauth2app');

module.exports = class GardenaOAuth2Client extends OAuth2Client {

  static get CACHE_TIMEOUT() {
    return 9000;
  }

  static get PING_INTERVAL() {
    return 1000 * 150; // 150s is recommended by https://developer.husqvarnagroup.cloud/apis/GARDENA+smart+system+API#rate-limits
  }

  static get WEBSOCKET_WATCHDOG_INTERVAL() {
    return 1000 * 60 * 60; // 1 hour
  }

  static get WEBSOCKET_RECONNECT_RETRY_LIMIT() {
    return 3;
  }

  constructor(...props) {
    super(...props);
    this.websocketReconnectRetryLimit = GardenaOAuth2Client.WEBSOCKET_RECONNECT_RETRY_LIMIT;
    this.websocketListeners = new Map();
    this.onPingInterval = this.onPingInterval.bind(this);
    this.onWebsocketWatchdogInterval = this.onWebsocketWatchdogInterval.bind(this);
    setInterval(this.onPingInterval, this.constructor.PING_INTERVAL);
    setInterval(this.onWebsocketWatchdogInterval, this.constructor.WEBSOCKET_WATCHDOG_INTERVAL);
  }

  /*
  The Gardena API must be ping'ed every 150s to stay connected.
  https://developer.husqvarnagroup.cloud/apis/GARDENA+smart+system+API#rate-limits
  */
  onPingInterval() {
    if (!this.websocketListeners) return;
    this.websocketListeners.forEach((websocketPromise, key) => {
      try {
        websocketPromise.then(websocket => {
          websocket.ping(() => {});
        }).catch(err => {
          console.log('ping error', err);
        });
      } catch (err) {
        console.log('Could not ping websocket', err);
      }
    });
  }

  onWebsocketWatchdogInterval() {
    this.websocketReconnectRetryLimit = GardenaOAuth2Client.WEBSOCKET_RECONNECT_RETRY_LIMIT;
    if (!this.websocketListeners) return;
    this.websocketListeners.forEach((websocketPromise, locationId) => {
      websocketPromise.then(websocket => {
        if (websocket.closed) {
          console.log('Found closed websocket. Trying to reopen...');
          const newWebSocketPromise = this.registerWebSocketForLocation({ locationId, callbacks: websocket.callbacks }).catch(err => {
            console.log('Got error from registerWebSocketForLocation: ', err);
          });
          this.websocketListeners.set(locationId, newWebSocketPromise);
          websocket.removeAllListeners();
        }
      }).catch(err => {
        console.log('something went wrong:', err);
      });
    });
  }

  async onRequestHeaders({ headers }) {
    const token = await this.getToken();
    if (!token) {
      throw new OAuth2Error('Missing Token');
    }

    return {
      ...headers,
      Authorization: `Bearer ${token.access_token}`,
      'Authorization-Provider': 'husqvarna',
      'X-Api-Key': Homey.env.GARDENA_API_KEY,
      'Content-Type': 'application/vnd.api+json',
    };
  }

  async onHandleResponse({
    response,
    status,
    statusText,
    headers,
    ok,
  }) {
    if (status === 202 || status === 204) {
      return undefined;
    }

    const body = await response.json();

    if (ok) {
      return body;
    }

    const err = await this.onHandleNotOK({
      body,
      status,
      statusText,
      headers,
    });

    if (!(err instanceof Error)) {
      throw new OAuth2Error('Invalid onHandleNotOK return value, expected: instanceof Error');
    }

    throw err;
  }

  async getLocations() {
    return this.get({
      path: '/locations',
    }).then(result => result.data);
  }

  async getLocation({ locationId }) {
    return this.get({
      path: `/locations/${locationId}`,
    });
  }

  async getLocationCached({ locationId }) {
    this._locationsCached = this._locationsCached || {};

    if (this._locationsCached[locationId]) {
      return this._locationsCached[locationId];
    }

    this._locationsCached[locationId] = this.getLocation({ locationId });

    setTimeout(() => {
      this._locationsCached[locationId] = null;
    }, this.constructor.CACHE_TIMEOUT);

    return this._locationsCached[locationId];
  }

  async sendCommand({
    serviceId, type, command, attributes,
  }) {
    return this.put({
      path: `/command/${serviceId}`,
      json: {
        data: {
          type,
          id: `request-${Date.now()}`,
          attributes: {
            command,
            ...attributes,
          },
        },
      },
    });
  }

  async registerWebsocketListener({ locationId }, callback) {
    console.log(locationId);
    if (!this.websocketListeners.has(locationId)) {
      console.log('creating socket for ', locationId);
      const websocketPromise = this.registerWebSocketForLocation({ locationId });
      this.websocketListeners.set(locationId, websocketPromise);
    } else {
      console.log('There already is a socket');
    }
    const websocket = await this.websocketListeners.get(locationId);
    websocket.callbacks.push(callback);
  }

  async unregisterWebsocketListener({ locationId }, callback) {
    const websocket = await this.websocketListeners.get(locationId);
    if (websocket) {
      websocket.callbacks = websocket.callbacks.filter(value => value !== callback);
      if (websocket.callbacks.length === 0) {
        console.log('Closing...', locationId);
        websocket.close();
        this.websocketListeners.delete(locationId);
      }
    }
  }

  async getWebsocketData({ locationId }) {
    return this.post({
      path: '/websocket',
      json: {
        data: {
          id: '1',
          type: 'WEBSOCKET',
          attributes: { locationId },
        },
      },
    });
  }

  async getWebSocket({ data, callbacks = [] }) {
    return new Promise((resolve, reject) => {
      const websocket = new WebSocket(data.attributes.url);
      websocket.callbacks = callbacks;
      websocket.closed = false;
      websocket.once('open', () => resolve(websocket));
      websocket.once('error', err => {
        console.log('ws error');
        reject(err);
      });
      websocket.on('message', message => {
        try {
          message = JSON.parse(message);
          websocket.callbacks.forEach(callback => {
            try {
              callback(message);
            } catch (err) {
              console.error(err);
            }
          });
        } catch (err) {
          console.error(err);
        }
      });
    });
  }

  async registerWebSocketForLocation({ locationId, callbacks = [] }) {
    const { data } = await this.getWebsocketData({ locationId });
    const websocket = await this.getWebSocket({ data, callbacks });
    websocket.once('close', err => {
      websocket.closed = true;
      console.log('Websocket closed!', locationId, err, new Date());
      // Force restoring web socket connection when closed
      // instead of waiting an hour, but limit reconnects
      // at 3 per hour (to prevent rate limiting issue)
      if (this.websocketReconnectRetryLimit > 0) {
        this.websocketReconnectRetryLimit--;
        this.onWebsocketWatchdogInterval();
      }
    });
    websocket.once('error', err => {
      websocket.closed = true;
      console.log('Websocket error! ', err);
      // Force restoring web socket connection when closed
      // instead of waiting an hour, but limit reconnects
      // at 3 per hour (to prevent rate limiting issue)
      if (this.websocketReconnectRetryLimit > 0) {
        this.websocketReconnectRetryLimit--;
        this.onWebsocketWatchdogInterval();
      }
    });
    return websocket;
  }

};
