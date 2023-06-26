'use strict';

const { OAuth2Token } = require('homey-oauth2app');

module.exports = class GardenaOAuth2Token extends OAuth2Token {

  constructor(token) {
    super(token);

    this.user_id = token.user_id;
  }

  toJSON() {
    return {
      ...super.toJSON(),
      user_id: this.user_id,
    };
  }

};
