'use strict';

const GardenaDevice = require('../../lib/GardenaDevice');

module.exports = class extends GardenaDevice {

  onGardenaInit() {
    this.registerCapabilityListener('onoff', this.onCapabilityOnoff.bind(this));
  }

  onPoll(devices) {
    super.onPoll(devices);

    devices.forEach(device => {
      if (device.attributes && device.attributes.activity) {
        this.setCapabilityValue('onoff', device.attributes.activity.value.endsWith('_ON')).catch(this.error);
      }
    });
  }

  async onCapabilityOnoff(value) {
    this._resetPollInterval();

    const service = this.getService('POWER_SOCKET');
    await this.oAuth2Client.sendCommand({
      serviceId: service.id,
      type: 'POWER_SOCKET_CONTROL',
      command: value
        ? 'START_OVERRIDE'
        : 'STOP_UNTIL_NEXT_TASK',
    });
  }

};
