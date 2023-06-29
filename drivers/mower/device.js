'use strict';

const { setTimeout } = require('timers/promises');

const { default: PQueue } = require('p-queue');

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
  PARKED_DAILY_LIMIT_REACHED: 'parked',
  PAUSED: 'paused',
  OK_CHARGING: 'charging', // Currently not used in Flow
  OK_SEARCHING: 'searching_station',
  OK_LEAVING: 'leaving_station',
  NONE: 'none',
};

const DELAY_AFTER_FLOW_TRIGGER = 3000;

module.exports = class extends GardenaDevice {

    // Limit number of simultaneous events processing to 1
    _processEventQueue = new PQueue({
      concurrency: 1,
    });

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

    getMowerState(entry) {
    // Check if mower state is known, else take the raw value as mowerState
      let mowerStateValue = mowerStateMap[entry.attributes.activity.value] ?? entry.attributes.activity.value;
      let mowerStateKey = entry.attributes.activity.value;
      // Mower state can be none in case it has reached its daily limit of mowing,
      // in that case there should also be an error with value 'PARKED_DAILY_LIMIT_REACHED'
      // if so consider mower state = parked.
      if (mowerStateValue === 'none') {
        if (entry.attributes && entry.attributes.state) {
          if (entry.attributes.lastErrorCode && (entry.attributes.state.value === 'ERROR' || entry.attributes.state.value === 'WARNING')) {
            if (entry.attributes.lastErrorCode.value === 'PARKED_DAILY_LIMIT_REACHED') {
            // Map the value from none to parked
              mowerStateValue = 'parked';

              // Map the key from NONE to PARKED_DAILY_LIMIT_REACHED for i18n
              mowerStateKey = 'PARKED_DAILY_LIMIT_REACHED';
            }
          }
        }
      }
      this.log('getMowerState -> ', { mowerStateKey, mowerStateValue });
      return { mowerStateKey, mowerStateValue };
    }

    onPoll(data) {
      super.onPoll(data);

      data.forEach(entry => {
      // Add to event processing queue to make sure
      // events aren't fired simultaneously, which could lead
      // to unexpected behaviour. For example, when the capability value
      // or the store isn't updated from the previous event yet. Events
      // often arrive very quickly after each other.
        this._processEventQueue.add(async () => {
          this.log('Update attributes:', entry.attributes);

          // Update operating hours capability
          if (entry.attributes && entry.attributes.operatingHours && typeof entry.attributes.operatingHours.value === 'number') {
            this.setCapabilityValue('gardena_operating_hours', entry.attributes.operatingHours.value).catch(this.error);
          }

          // Update mower state and trigger mower state changed Flow
          if (entry.attributes && entry.attributes.activity) {
            // Determine mower state based on new data
            const { mowerStateKey, mowerStateValue } = this.getMowerState(entry);
            const currentMowerStateInStore = this.getStoreValue('currentMowerState');

            // Cache last reported mower state
            await this.setStoreValue('currentMowerState', mowerStateValue).catch(this.error);

            this.log('onMowerState ->', { mowerStateKey, mowerStateValue, currentMowerStateInStore });

            // Set capability value with mower state key instead of value for sake of i18n
            this.log('onMowerState -> set capability value gardena_mower_state', mowerStateKey);
            await this.setCapabilityValue('gardena_mower_state', this.homey.__(mowerStateKey)).catch(this.error);

            // Trigger Flow if mower state changed
            if (mowerStateValue !== currentMowerStateInStore) {
              this.log('onMowerState -> detected change of mower state, trigger Flow gardena_mower_state_has_changed');
              // Note: using Flow card id "gardena_mower_state_changed" results in duplicate triggers
              await this.homey.flow.getDeviceTriggerCard('gardena_mower_state_has_changed').trigger(this, {}, {})
                .catch(this.error);
              // Wait DELAY_AFTER_FLOW_TRIGGER ms to give the Flows triggered by gardena_mower_state_has_changed some time to execute,
              // if we don't do this reading the condition "gardena_mower_state" might already be updated by a next event.
              await setTimeout(DELAY_AFTER_FLOW_TRIGGER);
              this.log('onMowerState -> Flow triggered');
            }
          }

          // Check if mower has an error and update warning and trigger Flow card respectively
          if (entry.attributes && entry.attributes.state) {
            if (entry.attributes.state.value === 'ERROR' || entry.attributes.state.value === 'WARNING') {
              // If mower has error and error is new
              if (entry.attributes.lastErrorCode) {
                // Don't consider this an error, just means the mower mowed until it reached its limit for the day and returned to base.
                if (entry.attributes.lastErrorCode.value !== 'PARKED_DAILY_LIMIT_REACHED') {
                  // Cache last reported mower error code to prevent duplicate Flow triggers
                  const currentErrorCodeValue = this.getStoreValue('currentErrorCodeValue');
                  if (entry.attributes.lastErrorCode.value) {
                    await this.setStoreValue('currentErrorCodeValue', entry.attributes.lastErrorCode.value).catch(this.error);
                  }
                  if (entry.attributes.lastErrorCode.value !== currentErrorCodeValue) {
                    // Set warning on device
                    this.setWarning(this.homey.__('mower_error_occurred', { error: entry.attributes.lastErrorCode.value })).catch(this.error);

                    // And trigger Flow card
                    await this.homey.flow.getDeviceTriggerCard('gardena_mower_state_error').trigger(this, { error_message: entry.attributes.lastErrorCode.value }, {}).catch(this.error);
                  }
                }
              }
            } else {
              // No error or warning is present (anymore) unset warning and store value
              await this.setStoreValue('currentErrorCodeValue', null).catch(this.error);
              this.unsetWarning().catch(this.error);
            }
          }
        });
      });
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
