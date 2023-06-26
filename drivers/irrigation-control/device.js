'use strict';

const GardenaDevice = require('../../lib/GardenaDevice');

module.exports = class extends GardenaDevice {

  onGardenaInit() {
    for (let i = 1; i <= this.driver.constructor.NUM_VALVES; i++) {
      const capabilityId = `onoff.valve${i}`;
      if (this.hasCapability(capabilityId)) {
        this.registerCapabilityListener(capabilityId, async (value, opts) => {
          return this.onCapabilityOnoffValve(value, {
            ...opts,
            valveId: i,
          });
        });
      }
    }

    for (let i = 1; i <= this.driver.constructor.NUM_VALVES; i++) {
      this.homey.flow.getActionCard(`irrigation_control_turn_on_valve${i}`)
        .registerRunListener(async ({ device, duration }) => {
          if (typeof duration === 'number') {
            duration /= (1000 * 60);
            duration = Math.ceil(duration);
          }
          const capabilityId = `onoff.valve${i}`;
          const capabilityValue = true;
          await device.triggerCapabilityListener(capabilityId, capabilityValue, { duration });
          await device.setCapabilityValue(capabilityId, capabilityValue);
        });

      this.homey.flow.getActionCard(`irrigation_control_turn_off_valve${i}`)
        .registerRunListener(async ({ device }) => {
          const capabilityId = `onoff.valve${i}`;
          const capabilityValue = false;
          await device.triggerCapabilityListener(capabilityId, capabilityValue);
          await device.setCapabilityValue(capabilityId, capabilityValue);
        });
    }
  }

  onPoll(devices) {
    super.onPoll(devices);

    devices.forEach(device => {
      // String(aabbcc:1) -> Number(1)
      const valveId = parseInt(device.id.split(':')[1], 10);
      if (Number.isNaN(valveId)) return;

      if (device.attributes && device.attributes.activity) {
        this.setCapabilityValue(`onoff.valve${valveId}`, device.attributes.activity.value.endsWith('_WATERING')).catch(this.error);
      }
    });
  }

  async onCapabilityOnoffValve(value, { valveId, duration }) {
    this._resetPollInterval();

    const { deviceId } = this.getData();

    if (typeof duration !== 'number') {
      duration = this.getSettings().duration;
    }

    await this.oAuth2Client.sendCommand({
      serviceId: `${deviceId}:${valveId}`,
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
