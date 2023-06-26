'use strict';

const { OAuth2Driver } = require('homey-oauth2app');

module.exports = class extends OAuth2Driver {

  onOAuth2Init() {
    this.onGardenaInit();
  }

  onGardenaInit() {
    // Overload Me
  }

  static FILTER_DEVICE(device) {
    return true;
  }

  async onPairListDevices({ oAuth2Client }) {
    const result = [];
    const locations = await oAuth2Client.getLocations();

    await Promise.all(locations.map(async ({ id: locationId }) => {
      const location = await oAuth2Client.getLocation({ locationId });
      if (!Array.isArray(location.included)) return;

      location.included.forEach(device => {
        if (!device.attributes || !device.attributes.name) return;
        if (!this.constructor.FILTER_DEVICE(device)) return;

        result.push({
          name: device.attributes.name.value,
          data: {
            locationId,
            deviceId: device.id,
          },
        });
      });
    }));

    return result;
  }

};
