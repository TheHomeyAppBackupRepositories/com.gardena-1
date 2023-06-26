'use strict';

const { OAuth2Device } = require('homey-oauth2app');

module.exports = class extends OAuth2Device {

  static get POLL_INTERVAL() {
    return 1000 * 60 * 60; // 1h
  }

  onOAuth2Init() {
    this.onPollInterval = this.onPollInterval.bind(this);

    const {
      deviceId,
      locationId,
    } = this.getData();

    this._resetPollInterval();
    this.onPollInterval();

    this.oAuth2Client.getLocationCached({
      locationId,
    }).then(async ({ included }) => {
      this.device = included.find(device => device.id === deviceId && device.relationships && device.relationships.services && Array.isArray(device.relationships.services.data));
      if (!this.device) {
        throw new Error('Cannot find the device anymore. Has it been removed?');
      }

      this.websocketListener = message => {
        // Note: found in the docs "Note: id of the command is only used for
        // logging purposes" (https://developer.husqvarnagroup.cloud/apis/GARDENA+smart+system+API#/readme)
        // It seems sometimes the message.id is suffixed with something, so we check for `includes()` as well.
        if (message.id !== deviceId && message.id.includes(deviceId) === false) return;

        // Calls the poll function when a websocket message is received
        this.onPoll([].concat(message));
      };
      await this.oAuth2Client.registerWebsocketListener({ locationId }, this.websocketListener);

      this.onGardenaInit();
    }).catch(err => {
      this.error(err);
      this.setUnavailable(err)
        .catch(error => this.error('Error setting Unavailable', error));
    });
  }

  onGardenaInit() {
    // Overload me
  }

  getService(type) {
    const service = this.device.relationships.services.data.find(service => service.type === type);
    if (!service) {
      throw new Error(`Invalid Service: ${type}`);
    }

    return service;
  }

  onOAuth2Deleted() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
    }

    if (this.websocketListener) {
      const { locationId } = this.getData();
      this.oAuth2Client
        .unregisterWebsocketListener({ locationId }, this.websocketListener)
        .catch(this.error);
    }
  }

  _resetPollInterval() {
    if (this.pollInterval) clearInterval(this.pollInterval);
    this.pollInterval = setInterval(this.onPollInterval, this.constructor.POLL_INTERVAL);
  }

  onPollInterval() {
    const {
      deviceId,
      locationId,
    } = this.getData();

    this.oAuth2Client.getLocationCached({
      locationId,
    }).then(({ included }) => {
      const devices = included.filter(device => device.id.includes(deviceId));
      if (!devices.length) {
        throw new Error('Cannot find the device anymore. Has it been removed?');
      }

      this.setAvailable()
        .catch(error => this.error('Error setting Available', error));
      this.onPoll(devices);
    }).catch(err => {
      this.error(err);
      this.setUnavailable(err)
        .catch(error => this.error('Error setting Unavailable', error));
    });
  }

  onPoll(devices) {
    devices.forEach(device => {
      if (device.attributes && device.attributes.rfLinkState) {
        if (device.attributes.rfLinkState.value === 'ONLINE') {
          this.setAvailable()
            .catch(error => this.error('Error setting Available', error));
        }
        if (device.attributes.rfLinkState.value === 'OFFLINE') {
          this.setUnavailable()
            .catch(error => this.error('Error setting Unavailable', error));
        }
      }

      if (this.hasCapability('gardena_wireless_quality')) {
        if (device.attributes && device.attributes.rfLinkLevel) {
          this.setCapabilityValue('gardena_wireless_quality', device.attributes.rfLinkLevel.value)
            .catch(err => this.error('Error setting gardena_wireless_quality', err));
        }
      }

      if (this.hasCapability('measure_battery')) {
        if (device.attributes && device.attributes.batteryLevel && typeof device.attributes.batteryLevel.value === 'number') {
          this.setCapabilityValue('measure_battery', device.attributes.batteryLevel.value)
            .catch(err => this.error('Error setting measure_battery', err));
        }
      }

      if (this.hasCapability('alarm_battery')) {
        if (device.attributes && device.attributes.batteryState && typeof device.attributes.batteryState.value === 'string') {
          this.setCapabilityValue('alarm_battery', device.attributes.batteryState.value !== 'OK')
            .catch(err => this.error('Error setting alarm_battery', err));
        }
      }
    });
  }

};
