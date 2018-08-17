"use strict";


// eslint-disable-next-line node/no-extraneous-require
const uuidv4 = require("uuid/v4");
const Knex = require("knex");

const AppConstants = require("../app-constants");
const HIBP = require("../hibp");
const getSha1 = require("../sha1-utils");

const knexConfig = require("./knexfile");
let knex = Knex(knexConfig[AppConstants.NODE_ENV]);


const DB = {
  async getSubscriberByToken(token) {
    const res = await knex("subscribers")
      .where("verification_token", "=", token);

    return res[0];
  },

  async addSubscriberUnverifiedEmailHash(email) {
    const res = await knex("subscribers").insert(
      { email: email, sha1: getSha1(email), verification_token: uuidv4(), verified: false }
    ).returning("*");
    return res[0];
  },

  async verifyEmailHash(token) {
    const unverifiedSubscriber = await this.getSubscriberByToken(token);
    const verifiedSubscriber = await this._verifySubscriber(unverifiedSubscriber);
    return verifiedSubscriber[0];
  },

  // Used internally, ideally should not be called by consumers.
  async _getSha1EntryAndDo(sha1, aFoundCallback, aNotFoundCallback) {
    const existingEntries = await knex("subscribers")
      .where("sha1", sha1);

    if (existingEntries.length && aFoundCallback) {
      return await aFoundCallback(existingEntries[0]);
    }

    if (!existingEntries.length && aNotFoundCallback) {
      return await aNotFoundCallback();
    }
  },

  // Used internally.
  async _addEmailHash(sha1, email, verified = false) {
    return await this._getSha1EntryAndDo(sha1, async aEntry => {
      // Entry existed, patch the email value if supplied.
      if (email) {
        const res = await knex("subscribers")
          .update({ email, verified })
          .where("id", "=", aEntry.id)
          .returning("*");
        return res[0];
      }

      return aEntry;
    }, async () => {
      const res = await knex("subscribers")
        .insert({ sha1, email, verified })
        .returning("*");
      return res[0];
    });
  },

  async addSubscriber(email) {
    const emailHash = await this._addEmailHash(getSha1(email), email, true);
    const verifiedSubscriber = await this._verifySubscriber(emailHash);
    return verifiedSubscriber[0];
  },

  async _verifySubscriber(emailHash) {
    await HIBP.subscribeHash(emailHash.sha1);
    const verifiedSubscriber = await knex("subscribers")
      .where("email", "=", emailHash.email)
      .update({ verified: true })
      .returning("*");
    return verifiedSubscriber;
  },

  async removeSubscriber(email) {
    // TODO: make this remove ALL subscriber records matching email?
    const sha1 = getSha1(email);

    return await this._getSha1EntryAndDo(sha1, async aEntry => {
      await knex("subscribers")
        .where("id", "=", aEntry.id)
        .del();
      console.log("Removed subscriber ID: ", aEntry.id);
      return aEntry;
    }, async () => {
      console.warn("removeSubscriber called with email not found in database.");
      return;
    });
  },

  async getSubscribersByHashes(hashes) {
    return await knex("subscribers").whereIn("sha1", hashes).andWhere("verified", "=", true);
  },

  async createConnection() {
    if (knex === null) {
      knex = Knex(knexConfig[AppConstants.NODE_ENV]);
    }
  },

  async destroyConnection() {
    await knex.destroy();
    knex = null;
  },

};

module.exports = DB;
