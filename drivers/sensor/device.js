'use strict';

const GardenaDevice = require('../../lib/GardenaDevice');

module.exports = class extends GardenaDevice {

  onGardenaInit() {
    if (this.hasCapability('gardena_alarm_frost')) {
      this.removeCapability('gardena_alarm_frost').catch(this.error);
    }
  }

  onPoll(devices) {
    super.onPoll(devices);

    devices.forEach(device => {
      if (device.attributes && device.attributes.soilHumidity) {
        const previousSoilHumidity = this.getCapabilityValue('measure_humidity.soil');
        const newSoilHumidity = parseFloat(device.attributes.soilHumidity.value);
        this.setCapabilityValue('measure_humidity.soil', newSoilHumidity).catch(this.error);
        if (previousSoilHumidity !== newSoilHumidity) {
          const tokens = { humidity: newSoilHumidity };
          this.homey.flow.getDeviceTriggerCard('soil_humidity_changed').trigger(this, tokens, {}).catch(this.error);
        }
      }

      if (device.attributes && device.attributes.soilTemperature) {
        const previousSoilTemperature = this.getCapabilityValue('measure_temperature.soil');
        const newSoilTemperature = parseFloat(device.attributes.soilTemperature.value);
        this.setCapabilityValue('measure_temperature.soil', newSoilTemperature).catch(this.error);
        if (previousSoilTemperature !== newSoilTemperature) {
          const tokens = { soil_temperature: newSoilTemperature };
          this.homey.flow.getDeviceTriggerCard('soil_temperature_changed').trigger(this, tokens, {}).catch(this.error);
        }
      }

      if (device.attributes && device.attributes.ambientTemperature && this.hasCapability('measure_temperature')) {
        this.setCapabilityValue('measure_temperature', parseFloat(device.attributes.ambientTemperature.value)).catch(this.error);
      }

      if (device.attributes && device.attributes.lightIntensity && this.hasCapability('measure_luminance')) {
        this.setCapabilityValue('measure_luminance', parseFloat(device.attributes.lightIntensity.value)).catch(this.error);
      }
    });
  }

};
