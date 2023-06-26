'use strict';

const { OAuth2App } = require('homey-oauth2app');
const GardenaOAuth2Client = require('./lib/GardenaOAuth2Client');
const GardenaOAuth2Token = require('./lib/GardenaOAuth2Token');

module.exports = class GardenaApp extends OAuth2App {

  onOAuth2Init() {
    this.log('GardenaApp is running...');

    this.enableOAuth2Debug();
    this.setOAuth2Config({
      client: GardenaOAuth2Client,
      token: GardenaOAuth2Token,
      apiUrl: 'https://api.smart.gardena.dev/v1',
      tokenUrl: 'https://api.authentication.husqvarnagroup.dev/v1/oauth2/token',
      authorizationUrl: 'https://api.authentication.husqvarnagroup.dev/v1/oauth2/authorize',
      scopes: ['iam:read'],
    });
  }

};
