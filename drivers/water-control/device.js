'use strict';

const GardenaDevice = require('../../lib/GardenaDevice');

module.exports = class extends GardenaDevice {

  onGardenaInit() {
    if (this.hasCapability('gardena_alarm_frost')) {
      this.removeCapability('gardena_alarm_frost').catch(this.error);
    }

    if (this.hasCapability('measure_temperature')) {
      this.removeCapability('measure_temperature').catch(this.error);
    }

    this.registerCapabilityListener('onoff', this.onCapabilityOnoff.bind(this));
  }

  onPoll(devices) {
    super.onPoll(devices);

    devices.forEach(device => {
      if (device.attributes && device.attributes.activity) {
        this.setCapabilityValue('onoff', device.attributes.activity.value.endsWith('_WATERING')).catch(this.error);
      }
    });
  }

  async onCapabilityOnoff(value) {
    this._resetPollInterval();

    const { duration } = this.getSettings();

    const service = this.getService('VALVE');
    await this.oAuth2Client.sendCommand({
      serviceId: service.id,
      type: 'VALVE_CONTROL',
      command: value
        ? 'START_SECONDS_TO_OVERRIDE'
        : 'STOP_UNTIL_NEXT_TASK',
      attributes: {
        seconds: duration * 60,
      },
    });
  }

};
