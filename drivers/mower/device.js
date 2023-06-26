'use strict';

const GardenaDevice = require('../../lib/GardenaDevice');

// Some Gardena provided states are a bit user unfriendly
// e.g. OK_CUTTING_TIMER_OVERRIDDEN, so we merge some of
// those states to simpler states for use in Flows.
const mowerStateMap = {
  OK_CUTTING: 'mowing',
  OK_CUTTING_TIMER_OVERRIDDEN: 'mowing',
  PARKED_TIMER: 'parked',
  PARKED_PARK_SELECTED: 'parked',
  PARKED_AUTO_TIMER: 'parked',
  PAUSED: 'paused',
  OK_CHARGING: 'charging', // Currently not used in Flow
  OK_SEARCHING: 'searching_station',
  OK_LEAVING: 'leaving_station',
};

module.exports = class extends GardenaDevice {

  onGardenaInit() {
    this.registerCapabilityListener('gardena_button.start', this.onCapabilityGardenaButtonStart.bind(this));
    this.registerCapabilityListener('gardena_button.park', this.onCapabilityGardenaButtonPark.bind(this));

    if (this.hasCapability('gardena_charging')) {
      this.removeCapability('gardena_charging').catch(this.error);
    }
    if (!this.hasCapability('gardena_operating_hours')) {
      this.addCapability('gardena_operating_hours').catch(this.error);
    }

    this.homey.flow.getActionCard('mower_start')
      .registerRunListener(async ({ device, duration }) => {
        if (typeof duration === 'number') {
          duration /= (1000 * 60);
          duration = Math.ceil(duration);
        }

        return device.start({ duration });
      });

    this.homey.flow.getActionCard('mower_park')
      .registerRunListener(async ({ device }) => {
        return device.park();
      });

    this.homey.flow.getConditionCard('gardena_mower_state_is')
      .registerRunListener(({ device, status }) => {
        const currentMowerState = device.getStoreValue('currentMowerState');

        // Override, when charging mower must also be parked
        if (status === 'parked' && currentMowerState === 'charging') return true;

        // Compare states and return true if matched
        return device.getStoreValue('currentMowerState') === status;
      });
  }

  async onCapabilityGardenaButtonStart() {
    return this.start();
  }

  async onCapabilityGardenaButtonPark() {
    return this.park();
  }

  onPoll(devices) {
    super.onPoll(devices);

    devices.forEach(device => {
      // Check if mower state changed
      this.onMowerState(device);
      // Check if mower is in error state
      this.onMowerError(device);
    });
  }

  onMowerState(device) {
    if (device.attributes && device.attributes.activity) {
      const newMowerState = mowerStateMap[device.attributes.activity.value];
      this.log('onMowerState ->', { newMowerState, currentMowerStateInStore: this.getStoreValue('currentMowerState') });
      // Trigger Flow if mower state changed
      if (newMowerState !== this.getStoreValue('currentMowerState')) {
        this.log('onMowerState -> detected change of mower state, trigger Flow');
        // Note: using Flow card id "gardena_mower_state_changed" results in duplicate triggers
        this.homey.flow.getDeviceTriggerCard('gardena_mower_state_has_changed').trigger(this, {}, {})
          .then(res => {
            this.log('onMowerState -> Flow triggered', { res });
          })
          .catch(this.error);
      }

      // Cache last reported mower state
      this.setStoreValue('currentMowerState', newMowerState).catch(this.error);

      this.setCapabilityValue('gardena_mower_state', this.homey.__(device.attributes.activity.value)).catch(this.error);
    }

    if (device.attributes && device.attributes.operatingHours && typeof device.attributes.operatingHours.value === 'number') {
      this.setCapabilityValue('gardena_operating_hours', device.attributes.operatingHours.value).catch(this.error);
    }
  }

  onMowerError(device) {
    if (device.attributes && device.attributes.state) {
      if (device.attributes.state.value === 'ERROR' || device.attributes.state.value === 'WARNING') {
        // If mower has error and error is new
        if (device.attributes.lastErrorCode) {
          if (device.attributes.lastErrorCode.value !== this.getStoreValue('currentErrorCodeValue')) {
            // Set warning on device
            this.setWarning(this.homey.__('mower_error_occurred', { error: device.attributes.lastErrorCode.value })).catch(this.error);
            // And trigger Flow card
            this.homey.flow.getDeviceTriggerCard('gardena_mower_state_error').trigger(this, { error_message: device.attributes.lastErrorCode.value }, {}).catch(this.error);
          }

          // Cache last reported mower error code to prevent duplicate Flow triggers
          if (device.attributes.lastErrorCode.value) {
            this.setStoreValue('currentErrorCodeValue', device.attributes.lastErrorCode.value).catch(this.error);
          }
        }
      } else {
        // No error or warning is present (anymore) unset warning and store value
        this.setStoreValue('currentErrorCodeValue', null).catch(this.error);
        this.unsetWarning().catch(this.error);
      }
    }
  }

  async start({ duration } = {}) {
    this._resetPollInterval();

    if (typeof duration !== 'number') {
      duration = this.getSettings().duration;
    }

    const service = this.getService('MOWER');

    await this.oAuth2Client.sendCommand({
      serviceId: service.id,
      type: 'MOWER_CONTROL',
      command: 'START_SECONDS_TO_OVERRIDE',
      attributes: {
        seconds: duration * 60,
      },
    });
  }

  async park() {
    this._resetPollInterval();

    const service = this.getService('MOWER');

    // Determine which of the two available park commands should be issued
    // PARK_UNTIL_NEXT_TASK - Cancel the current operation and return to charging station.
    // PARK_UNTIL_FURTHER_NOTICE - Cancel the current operation, return to charging station, ignore schedule.
    const parkCommand = this.getSetting('park_command_type') ? 'PARK_UNTIL_NEXT_TASK' : 'PARK_UNTIL_FURTHER_NOTICE';

    await this.oAuth2Client.sendCommand({
      serviceId: service.id,
      type: 'MOWER_CONTROL',
      command: parkCommand,
    });
  }

};
