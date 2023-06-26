'use strict';

const GardenaDriver = require('../../lib/GardenaDriver');

module.exports = class extends GardenaDriver {

  static FILTER_DEVICE(device) {
    return device.attributes.modelType && device.attributes.modelType.value === 'GARDENA smart Water Control';
  }

};
