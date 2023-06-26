'use strict';

const GardenaDriver = require('../../lib/GardenaDriver');

module.exports = class extends GardenaDriver {

  static get NUM_VALVES() {
    return 6;
  }

  static FILTER_DEVICE(device) {
    return device.attributes.modelType && device.attributes.modelType.value === 'GARDENA smart Irrigation Control';
  }

};
